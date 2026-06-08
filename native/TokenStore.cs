using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed record TokenState(
    string? Token,
    string Source,
    string SourceLabel,
    string ConfigPath,
    bool PortableTokenPresent,
    bool CliImportAvailable);

internal sealed class TokenStore(AppPaths paths)
{
    private static readonly HashSet<string> ColorModes = ["light", "soft", "dim", "dark", "system"];
    private static readonly HashSet<string> AccentThemes = ["blue", "teal", "rose"];
    private static readonly HashSet<string> AlertIcons = ["triangle", "beacon", "bolt", "dot", "green-dot"];
    private static readonly HashSet<string> ListStatuses = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];
    private static readonly HashSet<string> AdvancedFilterListTypes = ["status", "custom"];
    private static readonly HashSet<string> QuickListsModes = ["mini", "full", "hidden"];
    private const string AllStatus = "ALL";
    private const string CustomTabPrefix = "CUSTOM:";
    private const int MaxSavedFilters = 50;
    private const int MaxSavedFilterNameLength = 80;

    public TokenState Resolve()
    {
        var portableToken = ReadPortableToken();
        var cliImportAvailable = ReadCliToken() is not null;
        var envToken = Environment.GetEnvironmentVariable("ANILIST_TOKEN")
            ?? Environment.GetEnvironmentVariable("ANILIST_ACCESS_TOKEN");

        if (!string.IsNullOrWhiteSpace(envToken))
        {
            return new TokenState(envToken.Trim(), "env", "Environment", paths.ConfigLabel, portableToken is not null, cliImportAvailable);
        }

        if (portableToken is not null)
        {
            return new TokenState(portableToken, "portable", "Portable config", paths.ConfigLabel, true, cliImportAvailable);
        }

        return new TokenState(null, "none", cliImportAvailable ? "AniList CLI import available" : "None", paths.ConfigLabel, false, cliImportAvailable);
    }

    public string? ReadPortableToken()
    {
        var token = JsonUtil.String(paths.ReadPortableConfig(), "token");
        return string.IsNullOrWhiteSpace(token) ? null : token.Trim();
    }

    public string? ReadCliToken()
    {
        var token = JsonUtil.String(JsonUtil.ReadObject(AppPaths.CliConfigPath), "token");
        return string.IsNullOrWhiteSpace(token) ? null : token.Trim();
    }

    public void SavePortableToken(string token)
    {
        var config = paths.ReadPortableConfig();
        config["token"] = token.Trim();
        config["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
        paths.WritePortableConfig(config);
    }

    public void ClearPortableToken()
    {
        var config = paths.ReadPortableConfig();
        config.Remove("token");
        config["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
        paths.WritePortableConfig(config);
    }

    public JsonObject ReadPublicSettings()
    {
        var config = paths.ReadPortableConfig();
        var appearance = config["appearance"] as JsonObject;
        return new JsonObject
        {
            ["showNotes"] = JsonUtil.Bool(config, "showNotes") ?? JsonUtil.Bool(config, "notesMode") == true,
            ["simplifiedView"] = JsonUtil.Bool(config, "simplifiedView") ?? false,
            ["quickListsMode"] = NormalizeQuickListsMode(JsonUtil.String(config, "quickListsMode")),
            ["quickListsModeByTab"] = NormalizeQuickListsModeByTab(config["quickListsModeByTab"] as JsonObject, false),
            ["appearance"] = PublicAppearance(appearance),
            ["updates"] = PublicUpdates(config["updates"] as JsonObject),
            ["advancedFilters"] = PublicAdvancedFilters(config["advancedFilters"] as JsonObject)
        };
    }

    public JsonObject SavePublicSettings(JsonObject? appearanceInput = null, JsonObject? updatesInput = null, bool? showNotes = null, JsonObject? advancedFiltersInput = null, bool? simplifiedView = null, string? quickListsMode = null, JsonObject? quickListsModeByTabInput = null)
    {
        var config = paths.ReadPortableConfig();
        if (showNotes.HasValue)
        {
            config["showNotes"] = showNotes.Value;
        }
        if (simplifiedView.HasValue)
        {
            config["simplifiedView"] = simplifiedView.Value;
        }
        if (quickListsMode is not null)
        {
            config["quickListsMode"] = ValidateQuickListsMode(quickListsMode);
        }
        if (quickListsModeByTabInput is not null)
        {
            config["quickListsModeByTab"] = NormalizeQuickListsModeByTab(quickListsModeByTabInput, true);
        }
        if (appearanceInput is not null)
        {
            var currentAppearance = config["appearance"] as JsonObject ?? new JsonObject();
            if (appearanceInput.ContainsKey("colorMode"))
            {
                currentAppearance["colorMode"] = ValidateAppearanceValue(
                    JsonUtil.String(appearanceInput, "colorMode"),
                    ColorModes,
                    "Appearance color mode must be light, soft, dim, dark, or system.");
            }
            if (appearanceInput.ContainsKey("accentTheme"))
            {
                currentAppearance["accentTheme"] = ValidateAppearanceValue(
                    JsonUtil.String(appearanceInput, "accentTheme"),
                    AccentThemes,
                    "Appearance accent theme must be blue, teal, or rose.");
            }
            if (appearanceInput.ContainsKey("alertIcon"))
            {
                currentAppearance["alertIcon"] = ValidateAppearanceValue(
                    JsonUtil.String(appearanceInput, "alertIcon"),
                    AlertIcons,
                    "Appearance alert icon must be triangle, beacon, bolt, dot, or green-dot.");
            }
            if (appearanceInput.ContainsKey("showSynonymInfoIcon"))
            {
                currentAppearance["showSynonymInfoIcon"] = JsonUtil.Bool(appearanceInput, "showSynonymInfoIcon")
                    ?? throw new ApiException("Show Synonym Info Icon must be true or false.", 400);
            }
            if (appearanceInput.ContainsKey("showSynonymSubtitle"))
            {
                currentAppearance["showSynonymSubtitle"] = JsonUtil.Bool(appearanceInput, "showSynonymSubtitle")
                    ?? throw new ApiException("Show Synonym Subtitle must be true or false.", 400);
            }
            config["appearance"] = currentAppearance;
        }
        if (updatesInput is not null)
        {
            var currentUpdates = config["updates"]?.DeepClone() as JsonObject ?? new JsonObject();
            if (updatesInput.ContainsKey("autoCheckEnabled"))
            {
                currentUpdates["autoCheckEnabled"] = JsonUtil.Bool(updatesInput, "autoCheckEnabled")
                    ?? throw new ApiException("Daily update checks must be true or false.", 400);
            }
            config["updates"] = currentUpdates;
        }
        if (advancedFiltersInput is not null)
        {
            config["advancedFilters"] = NormalizeAdvancedFilters(advancedFiltersInput, true);
        }
        config["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
        paths.WritePortableConfig(config);
        return ReadPublicSettings();
    }

    private static string NormalizeQuickListsMode(string? value) =>
        string.Equals(value, "full", StringComparison.OrdinalIgnoreCase)
            ? "full"
            : string.Equals(value, "hidden", StringComparison.OrdinalIgnoreCase)
                ? "hidden"
                : "mini";

    private static string ValidateQuickListsMode(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized is not null && QuickListsModes.Contains(normalized)
            ? normalized
            : throw new ApiException("Quick Lists mode must be mini, full, or hidden.", 400);
    }

    private static JsonObject NormalizeQuickListsModeByTab(JsonObject? input, bool strict)
    {
        var modes = new JsonObject();
        if (input is null)
        {
            return modes;
        }

        foreach (var property in input)
        {
            var key = property.Key.Trim();
            if (!IsQuickListsModeTabKey(key))
            {
                if (strict)
                {
                    throw new ApiException("Quick Lists mode tab keys must be status values, ALL, or CUSTOM:<name>.", 400);
                }
                continue;
            }

            string mode;
            try
            {
                mode = ValidateQuickListsMode(property.Value?.GetValue<string>());
            }
            catch
            {
                if (strict)
                {
                    throw;
                }
                continue;
            }
            modes[key] = mode;
        }

        return modes;
    }

    private static JsonObject PublicAppearance(JsonObject? appearance) => new()
    {
        ["colorMode"] = NormalizedAppearanceValue(JsonUtil.String(appearance ?? new JsonObject(), "colorMode"), ColorModes, "soft"),
        ["accentTheme"] = NormalizedAppearanceValue(JsonUtil.String(appearance ?? new JsonObject(), "accentTheme"), AccentThemes, "teal"),
        ["alertIcon"] = NormalizedAppearanceValue(JsonUtil.String(appearance ?? new JsonObject(), "alertIcon"), AlertIcons, "green-dot"),
        ["showSynonymSubtitle"] = JsonUtil.Bool(appearance ?? new JsonObject(), "showSynonymSubtitle") ?? !(JsonUtil.Bool(appearance ?? new JsonObject(), "hideSynonymSubtitle") ?? false),
        ["showSynonymInfoIcon"] = JsonUtil.Bool(appearance ?? new JsonObject(), "showSynonymInfoIcon") ?? true
    };

    private static JsonObject PublicUpdates(JsonObject? updates) => new()
    {
        ["autoCheckEnabled"] = JsonUtil.Bool(updates ?? new JsonObject(), "autoCheckEnabled") ?? true
    };

    private static JsonObject PublicAdvancedFilters(JsonObject? advancedFilters)
    {
        try
        {
            return NormalizeAdvancedFilters(advancedFilters, false);
        }
        catch
        {
            return EmptyAdvancedFilters();
        }
    }

    private static JsonObject EmptyAdvancedFilters() => new()
    {
        ["filters"] = new JsonArray(),
        ["defaultByStatus"] = new JsonObject()
    };

    private static JsonObject NormalizeAdvancedFilters(JsonObject? input, bool strict)
    {
        if (input is null)
        {
            return EmptyAdvancedFilters();
        }

        var filtersInput = JsonUtil.Array(input, "filters");
        if (strict && filtersInput.Count > MaxSavedFilters)
        {
            throw new ApiException($"Saved filters are limited to {MaxSavedFilters}.", 400);
        }

        var filters = new JsonArray();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var filterNode in filtersInput.OfType<JsonObject>())
        {
            if (filters.Count >= MaxSavedFilters)
            {
                break;
            }

            var id = JsonUtil.String(filterNode, "id")?.Trim();
            var name = JsonUtil.String(filterNode, "name")?.Trim();
            var listType = JsonUtil.String(filterNode, "listType")?.Trim().ToLowerInvariant();
            var filter = filterNode["filter"] as JsonObject;
            if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(name) || filter is null)
            {
                if (strict)
                {
                    throw new ApiException("Each saved filter must include an id, name, and filter object.", 400);
                }
                continue;
            }
            if (name.Length > MaxSavedFilterNameLength)
            {
                if (strict)
                {
                    throw new ApiException($"Saved filter names are limited to {MaxSavedFilterNameLength} characters.", 400);
                }
                name = name[..MaxSavedFilterNameLength];
            }
            if (!seenIds.Add(id))
            {
                if (strict)
                {
                    throw new ApiException("Saved filter ids must be unique.", 400);
                }
                continue;
            }
            if (!string.IsNullOrWhiteSpace(listType) && !AdvancedFilterListTypes.Contains(listType))
            {
                if (strict)
                {
                    throw new ApiException("Saved filter list type must be status or custom.", 400);
                }
                listType = null;
            }

            var normalizedFilter = new JsonObject
            {
                ["id"] = id,
                ["name"] = name,
                ["filter"] = filter.DeepClone()
            };
            if (!string.IsNullOrWhiteSpace(listType))
            {
                normalizedFilter["listType"] = listType;
            }
            filters.Add((JsonNode?)normalizedFilter);
        }

        var defaultByStatus = new JsonObject();
        var defaultsInput = input["defaultByStatus"] as JsonObject;
        if (defaultsInput is not null)
        {
            foreach (var property in defaultsInput)
            {
                var key = property.Key.Trim();
                if (!IsAdvancedFilterDefaultKey(key))
                {
                    continue;
                }

                var savedId = property.Value?.GetValue<string>()?.Trim();
                if (!string.IsNullOrWhiteSpace(savedId) && seenIds.Contains(savedId))
                {
                    defaultByStatus[key] = savedId;
                }
            }
        }

        return new JsonObject
        {
            ["filters"] = filters,
            ["defaultByStatus"] = defaultByStatus
        };
    }

    private static bool IsAdvancedFilterDefaultKey(string key)
    {
        if (ListStatuses.Contains(key))
        {
            return true;
        }

        if (!key.StartsWith(CustomTabPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var name = key[CustomTabPrefix.Length..].Trim();
        return name.Length is > 0 and <= MaxSavedFilterNameLength && !name.Any(char.IsControl);
    }

    private static bool IsQuickListsModeTabKey(string key)
    {
        if (key == AllStatus || ListStatuses.Contains(key))
        {
            return true;
        }

        if (!key.StartsWith(CustomTabPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        var name = key[CustomTabPrefix.Length..].Trim();
        return name.Length is > 0 and <= MaxSavedFilterNameLength && !name.Any(char.IsControl);
    }

    private static string NormalizedAppearanceValue(string? value, HashSet<string> allowedValues, string fallback)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized is not null && allowedValues.Contains(normalized) ? normalized : fallback;
    }

    private static string ValidateAppearanceValue(string? value, HashSet<string> allowedValues, string error)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return normalized is not null && allowedValues.Contains(normalized)
            ? normalized
            : throw new ApiException(error, 400);
    }

    public JsonObject HealthJson()
    {
        var state = Resolve();
        return new JsonObject
        {
            ["ok"] = true,
            ["app"] = "anilist-manager",
            ["tokenPresent"] = state.Token is not null,
            ["tokenSource"] = state.Source,
            ["tokenSourceLabel"] = state.SourceLabel,
            ["configPath"] = state.ConfigPath,
            ["portableTokenPresent"] = state.PortableTokenPresent,
            ["cliImportAvailable"] = state.CliImportAvailable
        };
    }
}
