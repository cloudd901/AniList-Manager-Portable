using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed class ListMetadataStore(AppPaths paths)
{
    public const string AllKey = "ALL";
    public const string CustomPrefix = "CUSTOM:";
    private static readonly string[] Statuses = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];
    private static readonly Dictionary<string, string> StatusLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        ["CURRENT"] = "Watching",
        ["PLANNING"] = "Planning",
        ["COMPLETED"] = "Completed",
        ["PAUSED"] = "Paused",
        ["DROPPED"] = "Dropped",
        ["REPEATING"] = "Repeating"
    };
    private readonly object storeLock = new();

    public JsonObject ReadPublicSettings()
    {
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            return new JsonObject
            {
                ["visibleTabs"] = CloneArray(metadata["visibleTabs"] as JsonArray),
                ["defaultTab"] = JsonUtil.String(metadata, "defaultTab") ?? "CURRENT",
                ["tabOrder"] = CloneArray(metadata["tabOrder"] as JsonArray)
            };
        }
    }

    public JsonObject ReadTabs(string type)
    {
        EnsureAnime(type);
        lock (storeLock)
        {
            return BuildTabsUnlocked(ReadNormalizedUnlocked(), type);
        }
    }

    public JsonObject SaveSettings(JsonObject input)
    {
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            var customLists = ReadCustomLists(metadata);
            var visible = input.ContainsKey("visibleTabs")
                ? NormalizeVisibleTabs(input["visibleTabs"] as JsonArray ?? throw new ApiException("Visible tabs must be an array.", 400), customLists, true)
                : NormalizeVisibleTabs(metadata["visibleTabs"] as JsonArray, customLists, false);
            metadata["visibleTabs"] = visible;
            var order = input.ContainsKey("tabOrder")
                ? NormalizeTabOrder(input["tabOrder"] as JsonArray ?? throw new ApiException("Tab order must be an array.", 400), customLists)
                : NormalizeTabOrder(metadata["tabOrder"] as JsonArray, customLists);
            metadata["tabOrder"] = order;
            if (input.ContainsKey("defaultTab"))
            {
                metadata["defaultTab"] = NormalizeDefaultTab(JsonUtil.String(input, "defaultTab"), visible);
            }
            else
            {
                metadata["defaultTab"] = NormalizeDefaultTab(JsonUtil.String(metadata, "defaultTab"), visible);
            }
            WriteUnlocked(metadata);
            return ReadPublicSettings();
        }
    }

    public JsonObject UpdateMetadata(JsonObject input, string type)
    {
        EnsureAnime(type);
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            if (input["customLists"] is JsonArray customLists)
            {
                MergeCustomListsUnlocked(metadata, customLists.Select(node => node?.GetValue<string>() ?? ""), false);
            }
            if (input["counts"] is JsonObject counts)
            {
                UpdateCountsUnlocked(metadata, counts);
            }
            WriteUnlocked(metadata);
            return BuildTabsUnlocked(ReadNormalizedUnlocked(), type);
        }
    }

    public void UpdateFromStatus(string status, string type, JsonArray entries)
    {
        EnsureAnime(type);
        if (!Statuses.Contains(status, StringComparer.OrdinalIgnoreCase))
        {
            return;
        }
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            var counts = metadata["counts"] as JsonObject ?? new JsonObject();
            counts[status.ToUpperInvariant()] = entries.Count;
            metadata["counts"] = counts;
            MergeCustomListsUnlocked(metadata, CustomListsFromEntries(entries), false);
            WriteUnlocked(metadata);
        }
    }

    public JsonObject MergeCustomLists(IEnumerable<string> names, string type, bool addToVisible = true)
    {
        EnsureAnime(type);
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            MergeCustomListsUnlocked(metadata, names, addToVisible);
            WriteUnlocked(metadata);
            return BuildTabsUnlocked(ReadNormalizedUnlocked(), type);
        }
    }

    public JsonObject ReplaceCustomListsFromRemote(IEnumerable<string> names, string type)
    {
        EnsureAnime(type);
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            var customLists = NormalizeRemoteCustomLists(names);
            metadata["customLists"] = ToArray(customLists);
            metadata["visibleTabs"] = NormalizeVisibleTabs(metadata["visibleTabs"] as JsonArray, customLists, true);
            metadata["tabOrder"] = NormalizeTabOrder(metadata["tabOrder"] as JsonArray, customLists);
            metadata["defaultTab"] = NormalizeDefaultTab(JsonUtil.String(metadata, "defaultTab"), metadata["visibleTabs"] as JsonArray);
            RemoveStaleCustomCounts(metadata, customLists);
            WriteUnlocked(metadata);
            return BuildTabsUnlocked(ReadNormalizedUnlocked(), type);
        }
    }

    public JsonObject DeleteCustomList(string name, string type)
    {
        EnsureAnime(type);
        var normalizedName = NormalizeCustomListName(name);
        lock (storeLock)
        {
            var metadata = ReadNormalizedUnlocked();
            var remaining = ReadCustomLists(metadata)
                .Where(item => !string.Equals(item, normalizedName, StringComparison.OrdinalIgnoreCase))
                .ToArray();
            metadata["customLists"] = ToArray(remaining);

            var removedKey = CustomKey(normalizedName);
            metadata["visibleTabs"] = NormalizeVisibleTabs(
                ToArray(ReadVisibleTabs(metadata).Where(key => !string.Equals(key, removedKey, StringComparison.OrdinalIgnoreCase))),
                remaining,
                true);
            metadata["tabOrder"] = NormalizeTabOrder(
                ToArray(ReadTabOrder(metadata).Where(key => !string.Equals(key, removedKey, StringComparison.OrdinalIgnoreCase))),
                remaining);
            metadata["defaultTab"] = NormalizeDefaultTab(JsonUtil.String(metadata, "defaultTab"), metadata["visibleTabs"] as JsonArray);
            if (metadata["counts"] is JsonObject counts)
            {
                counts.Remove(removedKey);
            }
            WriteUnlocked(metadata);
            return BuildTabsUnlocked(ReadNormalizedUnlocked(), type);
        }
    }

    public static string NormalizeCustomListName(string? value)
    {
        var normalized = new string((value ?? "").Trim().Where(ch => !char.IsControl(ch)).ToArray());
        if (string.IsNullOrWhiteSpace(normalized))
        {
            throw new ApiException("Enter a custom list name.", 400);
        }
        if (normalized.Length > 80)
        {
            throw new ApiException("Custom list names are limited to 80 characters.", 400);
        }
        return normalized;
    }

    public static string CustomKey(string name) => $"{CustomPrefix}{NormalizeCustomListName(name)}";

    private JsonObject ReadNormalizedUnlocked()
    {
        var metadata = JsonUtil.ReadObject(paths.ListMetadataPath);
        var customLists = ReadCustomLists(metadata);
        var visible = NormalizeVisibleTabs(metadata["visibleTabs"] as JsonArray, customLists, metadata["visibleTabs"] is JsonArray);
        metadata["version"] = 1;
        metadata["customLists"] = ToArray(customLists);
        metadata["visibleTabs"] = visible;
        metadata["tabOrder"] = NormalizeTabOrder(metadata["tabOrder"] as JsonArray, customLists);
        metadata["defaultTab"] = NormalizeDefaultTab(JsonUtil.String(metadata, "defaultTab"), visible);
        metadata["counts"] = metadata["counts"] as JsonObject ?? new JsonObject();
        return metadata;
    }

    private JsonObject BuildTabsUnlocked(JsonObject metadata, string type)
    {
        var counts = metadata["counts"] as JsonObject ?? new JsonObject();
        var customLists = ReadCustomLists(metadata);
        var tabsByKey = new Dictionary<string, JsonObject>(StringComparer.OrdinalIgnoreCase);
        foreach (var status in Statuses)
        {
            tabsByKey[status] = new JsonObject
            {
                ["key"] = status,
                ["label"] = StatusLabels[status],
                ["kind"] = "status",
                ["status"] = status,
                ["customList"] = null,
                ["count"] = CountNode(counts, status)
            };
        }
        foreach (var customList in customLists)
        {
            var key = CustomKey(customList);
            tabsByKey[key] = new JsonObject
            {
                ["key"] = key,
                ["label"] = customList,
                ["kind"] = "custom",
                ["status"] = null,
                ["customList"] = customList,
                ["count"] = CountNode(counts, key)
            };
        }
        tabsByKey[AllKey] = new JsonObject
        {
            ["key"] = AllKey,
            ["label"] = "All",
            ["kind"] = "all",
            ["status"] = null,
            ["customList"] = null,
            ["count"] = CountNode(counts, AllKey)
        };

        var tabOrder = NormalizeTabOrder(metadata["tabOrder"] as JsonArray, customLists);
        var tabs = new JsonArray();
        foreach (var key in tabOrder.Select(node => node?.GetValue<string>() ?? ""))
        {
            if (tabsByKey.TryGetValue(key, out var tab))
            {
                tabs.Add((JsonNode?)tab.DeepClone());
            }
        }

        var publicSettings = ReadPublicSettingsFromMetadata(metadata);
        return new JsonObject
        {
            ["type"] = type,
            ["customLists"] = ToArray(customLists),
            ["visibleTabs"] = publicSettings["visibleTabs"]?.DeepClone(),
            ["defaultTab"] = publicSettings["defaultTab"]?.DeepClone(),
            ["tabOrder"] = publicSettings["tabOrder"]?.DeepClone(),
            ["counts"] = BuildCountsObject(counts, customLists),
            ["tabs"] = tabs
        };
    }

    private static JsonObject ReadPublicSettingsFromMetadata(JsonObject metadata) => new()
    {
        ["visibleTabs"] = CloneArray(metadata["visibleTabs"] as JsonArray),
        ["defaultTab"] = JsonUtil.String(metadata, "defaultTab") ?? "CURRENT",
        ["tabOrder"] = CloneArray(metadata["tabOrder"] as JsonArray)
    };

    private static JsonObject BuildCountsObject(JsonObject counts, IReadOnlyList<string> customLists)
    {
        var result = new JsonObject();
        foreach (var status in Statuses)
        {
            result[status] = CountNode(counts, status);
        }
        foreach (var customList in customLists)
        {
            var key = CustomKey(customList);
            result[key] = CountNode(counts, key);
        }
        result[AllKey] = CountNode(counts, AllKey);
        return result;
    }

    private static JsonNode? CountNode(JsonObject counts, string key)
    {
        var value = CountValue(counts, key);
        return value.HasValue ? JsonValue.Create(value.Value) : null;
    }

    private static int? CountValue(JsonObject counts, string key)
    {
        var value = JsonUtil.Int(counts, key);
        return value is >= 0 ? value : null;
    }

    private static void UpdateCountsUnlocked(JsonObject metadata, JsonObject input)
    {
        var counts = metadata["counts"] as JsonObject ?? new JsonObject();
        var customLists = ReadCustomLists(metadata).ToList();
        foreach (var property in input.ToArray())
        {
            var key = NormalizeTabKey(property.Key, customLists);
            if (key is null)
            {
                continue;
            }
            if (property.Value is null)
            {
                counts.Remove(key);
                continue;
            }
            var count = JsonUtil.Int(input, property.Key);
            if (count is >= 0)
            {
                counts[key] = count.Value;
            }
        }
        metadata["counts"] = counts;
        metadata["customLists"] = ToArray(customLists);
    }

    private static void MergeCustomListsUnlocked(JsonObject metadata, IEnumerable<string> names, bool addToVisible)
    {
        var customLists = ReadCustomLists(metadata).ToList();
        var visibleTabs = ReadVisibleTabs(metadata).ToList();
        var tabOrder = ReadTabOrder(metadata).ToList();
        var changed = false;
        foreach (var rawName in names)
        {
            string name;
            try
            {
                name = NormalizeCustomListName(rawName);
            }
            catch
            {
                continue;
            }
            if (customLists.Any(item => string.Equals(item, name, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }
            customLists.Add(name);
            var key = CustomKey(name);
            if (!tabOrder.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                tabOrder.Add(key);
            }
            if (addToVisible && !visibleTabs.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                visibleTabs.Add(key);
            }
            changed = true;
        }
        if (changed)
        {
            customLists.Sort(StringComparer.CurrentCultureIgnoreCase);
        }
        metadata["customLists"] = ToArray(customLists);
        metadata["visibleTabs"] = NormalizeVisibleTabs(ToArray(visibleTabs), customLists, true);
        metadata["tabOrder"] = NormalizeTabOrder(ToArray(tabOrder), customLists);
        metadata["defaultTab"] = NormalizeDefaultTab(JsonUtil.String(metadata, "defaultTab"), metadata["visibleTabs"] as JsonArray);
    }

    private static IReadOnlyList<string> NormalizeRemoteCustomLists(IEnumerable<string> names)
    {
        var result = new List<string>();
        foreach (var rawName in names)
        {
            string name;
            try
            {
                name = NormalizeCustomListName(rawName);
            }
            catch
            {
                continue;
            }
            if (!result.Contains(name, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(name);
            }
        }
        result.Sort(StringComparer.CurrentCultureIgnoreCase);
        return result;
    }

    private static void RemoveStaleCustomCounts(JsonObject metadata, IReadOnlyList<string> customLists)
    {
        if (metadata["counts"] is not JsonObject counts)
        {
            return;
        }
        foreach (var property in counts.ToArray())
        {
            if (!property.Key.StartsWith(CustomPrefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            string? key;
            try
            {
                key = NormalizeTabKey(property.Key, customLists);
            }
            catch
            {
                key = null;
            }
            if (key is null)
            {
                counts.Remove(property.Key);
            }
        }
    }

    private static IReadOnlyList<string> ReadCustomLists(JsonObject metadata)
    {
        var result = new List<string>();
        foreach (var node in metadata["customLists"] as JsonArray ?? [])
        {
            try
            {
                var name = NormalizeCustomListName(node?.GetValue<string>());
                if (!result.Contains(name, StringComparer.OrdinalIgnoreCase))
                {
                    result.Add(name);
                }
            }
            catch
            {
            }
        }
        result.Sort(StringComparer.CurrentCultureIgnoreCase);
        return result;
    }

    private static IReadOnlyList<string> ReadVisibleTabs(JsonObject metadata)
    {
        var customLists = ReadCustomLists(metadata);
        return NormalizeVisibleTabs(metadata["visibleTabs"] as JsonArray, customLists, metadata["visibleTabs"] is JsonArray)
            .Select(node => node?.GetValue<string>() ?? "")
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
    }

    private static IReadOnlyList<string> ReadTabOrder(JsonObject metadata)
    {
        var customLists = ReadCustomLists(metadata);
        return NormalizeTabOrder(metadata["tabOrder"] as JsonArray, customLists)
            .Select(node => node?.GetValue<string>() ?? "")
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
    }

    private static JsonArray NormalizeVisibleTabs(JsonArray? input, IReadOnlyList<string> customLists, bool configured)
    {
        var defaultOrder = DefaultTabOrder(customLists);
        var allowed = new HashSet<string>(defaultOrder, StringComparer.OrdinalIgnoreCase);

        var result = new List<string>();
        var source = configured && input is not null
            ? input.Select(node => node?.GetValue<string>() ?? "")
            : defaultOrder;
        foreach (var rawKey in source)
        {
            var key = NormalizeTabKey(rawKey, customLists);
            if (key is not null && allowed.Contains(key) && !result.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(key);
            }
        }
        if (result.Count == 0)
        {
            result.Add(allowed.Contains("CURRENT") ? "CURRENT" : AllKey);
        }
        return ToArray(result);
    }

    private static JsonArray NormalizeTabOrder(JsonArray? input, IReadOnlyList<string> customLists)
    {
        var defaultOrder = DefaultTabOrder(customLists);
        var allowed = new HashSet<string>(defaultOrder, StringComparer.OrdinalIgnoreCase);
        var result = new List<string>();
        foreach (var rawKey in input?.Select(node => node?.GetValue<string>() ?? "") ?? [])
        {
            var key = NormalizeTabKey(rawKey, customLists);
            if (key is not null && allowed.Contains(key) && !result.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(key);
            }
        }
        foreach (var key in defaultOrder)
        {
            if (!result.Contains(key, StringComparer.OrdinalIgnoreCase))
            {
                result.Add(key);
            }
        }
        return ToArray(result);
    }

    private static IReadOnlyList<string> DefaultTabOrder(IReadOnlyList<string> customLists) =>
        Statuses
            .Concat(customLists.Select(CustomKey))
            .Append(AllKey)
            .ToArray();

    private static string NormalizeDefaultTab(string? value, JsonArray? visibleTabs)
    {
        var visible = (visibleTabs ?? [])
            .Select(node => node?.GetValue<string>() ?? "")
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
        var requested = (value ?? "").Trim();
        if (visible.Contains(requested, StringComparer.OrdinalIgnoreCase))
        {
            return visible.First(item => string.Equals(item, requested, StringComparison.OrdinalIgnoreCase));
        }
        if (visible.Contains("CURRENT", StringComparer.OrdinalIgnoreCase))
        {
            return "CURRENT";
        }
        return visible.FirstOrDefault() ?? "CURRENT";
    }

    private static string? NormalizeTabKey(string? rawKey, IReadOnlyList<string> customLists)
    {
        var key = (rawKey ?? "").Trim();
        if (string.IsNullOrWhiteSpace(key))
        {
            return null;
        }
        if (string.Equals(key, AllKey, StringComparison.OrdinalIgnoreCase))
        {
            return AllKey;
        }
        var status = Statuses.FirstOrDefault(item => string.Equals(item, key, StringComparison.OrdinalIgnoreCase));
        if (status is not null)
        {
            return status;
        }
        if (key.StartsWith(CustomPrefix, StringComparison.OrdinalIgnoreCase))
        {
            var name = NormalizeCustomListName(key[CustomPrefix.Length..]);
            var known = customLists.FirstOrDefault(item => string.Equals(item, name, StringComparison.OrdinalIgnoreCase));
            return known is null ? null : CustomKey(known);
        }
        return null;
    }

    private static IEnumerable<string> CustomListsFromEntries(JsonArray entries)
    {
        foreach (var entry in entries.OfType<JsonObject>())
        {
            foreach (var item in entry["customLists"] as JsonArray ?? [])
            {
                var name = item?.GetValue<string>();
                if (!string.IsNullOrWhiteSpace(name))
                {
                    yield return name;
                }
            }
        }
    }

    private void WriteUnlocked(JsonObject metadata)
    {
        metadata["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
        Directory.CreateDirectory(paths.DataDir);
        File.WriteAllText(paths.ListMetadataPath, metadata.ToJsonString(JsonUtil.WriterOptions));
    }

    private static JsonArray ToArray(IEnumerable<string> values)
    {
        var result = new JsonArray();
        foreach (var value in values)
        {
            result.Add((JsonNode?)JsonValue.Create(value));
        }
        return result;
    }

    private static JsonArray CloneArray(JsonArray? array) => array?.DeepClone().AsArray() ?? new JsonArray();

    private static void EnsureAnime(string type)
    {
        if (!string.Equals(type, "ANIME", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("Only ANIME lists are supported.", 400);
        }
    }
}
