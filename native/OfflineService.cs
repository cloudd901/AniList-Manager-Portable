using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed class OfflineService(AppPaths paths, AniListClient aniList, AvailabilityService availability, HttpClient http)
{
    private static readonly string[] PackageStatuses = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];
    private readonly object storeLock = new();
    private readonly ConcurrentDictionary<string, EnableJob> enableJobs = new();

    public bool IsEnabled
    {
        get
        {
            lock (storeLock)
            {
                return JsonUtil.Bool(JsonUtil.ReadObject(paths.OfflineStatePath), "enabled") == true
                    && File.Exists(paths.OfflinePackagePath);
            }
        }
    }

    public JsonObject Status()
    {
        lock (storeLock)
        {
            return StatusUnlocked();
        }
    }

    public JsonObject BeginEnable()
    {
        if (IsEnabled)
        {
            throw new ApiException("Offline Mode is already enabled.", 409);
        }

        var job = new EnableJob(Guid.NewGuid().ToString("N"));
        enableJobs[job.Id] = job;
        _ = Task.Run(() => RunEnableAsync(job));
        return job.ToJson();
    }

    public JsonObject GetEnableJob(string jobId)
    {
        if (enableJobs.TryGetValue(jobId, out var job))
        {
            return job.ToJson();
        }
        throw new ApiException("Offline enable job was not found.", 404);
    }

    public JsonObject OfflineAuthState(TokenState tokenState)
    {
        var package = ReadPackageUnlocked();
        return new JsonObject
        {
            ["tokenPresent"] = tokenState.Token is not null,
            ["tokenSource"] = tokenState.Source,
            ["tokenSourceLabel"] = tokenState.SourceLabel,
            ["configPath"] = tokenState.ConfigPath,
            ["portableTokenPresent"] = tokenState.PortableTokenPresent,
            ["cliImportAvailable"] = tokenState.CliImportAvailable,
            ["valid"] = tokenState.Token is not null,
            ["user"] = package["user"]?.DeepClone(),
            ["offline"] = true
        };
    }

    public JsonObject GetList(string status, string type)
    {
        lock (storeLock)
        {
            var package = ReadPackageUnlocked();
            var list = package["lists"]?[status] as JsonObject
                ?? throw new ApiException("This list was not packaged for Offline Mode.", 404);
            return new JsonObject
            {
                ["user"] = package["user"]?.DeepClone() ?? new JsonObject(),
                ["type"] = type,
                ["status"] = status,
                ["listName"] = JsonUtil.String(list, "listName") ?? status,
                ["entries"] = (list["entries"] as JsonArray)?.DeepClone() ?? new JsonArray(),
                ["availability"] = package["availability"]?.DeepClone() ?? new JsonObject(),
                ["ratings"] = package["ratings"]?.DeepClone() ?? new JsonObject(),
                ["offline"] = true,
                ["queued"] = QueueCountUnlocked()
            };
        }
    }

    public JsonObject GetAvailability(JsonArray entries)
    {
        lock (storeLock)
        {
            var package = ReadPackageUnlocked();
            var saved = package["availability"] as JsonObject ?? new JsonObject();
            var results = new JsonArray();
            foreach (var entry in entries.OfType<JsonObject>())
            {
                var mediaId = JsonUtil.Int(entry, "mediaId");
                if (mediaId is not null && saved[mediaId.Value.ToString()] is JsonObject result)
                {
                    results.Add(result.DeepClone());
                }
            }
            return new JsonObject
            {
                ["source"] = "offline",
                ["entries"] = results,
                ["warnings"] = new JsonArray(),
                ["warningCount"] = 0,
                ["rateLimited"] = false,
                ["cached"] = results.Count,
                ["checked"] = 0,
                ["cacheOnly"] = true,
                ["offline"] = true
            };
        }
    }

    public JsonObject GetRatings(JsonArray entries)
    {
        lock (storeLock)
        {
            var package = ReadPackageUnlocked();
            var saved = package["ratings"] as JsonObject ?? new JsonObject();
            var results = new JsonArray();
            foreach (var entry in entries.OfType<JsonObject>())
            {
                var mediaId = JsonUtil.Int(entry, "mediaId");
                if (mediaId is not null && saved[mediaId.Value.ToString()] is JsonObject result)
                {
                    results.Add(result.DeepClone());
                }
            }
            return new JsonObject
            {
                ["entries"] = results,
                ["rateLimited"] = false,
                ["offline"] = true
            };
        }
    }

    public (byte[] Bytes, string ContentType) ReadImage(string fileName)
    {
        if (string.IsNullOrWhiteSpace(fileName) || fileName.IndexOfAny([Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar]) >= 0)
        {
            throw new ApiException("Invalid offline image.", 400);
        }
        var path = Path.Combine(paths.OfflineImagesDir, fileName);
        if (!File.Exists(path))
        {
            throw new ApiException("Offline image was not found.", 404);
        }
        return (File.ReadAllBytes(path), ImageContentType(Path.GetExtension(path)));
    }

    public JsonObject QueueSummary()
    {
        lock (storeLock)
        {
            var package = ReadPackageUnlocked();
            var queue = ReadQueueUnlocked();
            var items = new JsonArray();
            foreach (var item in JsonUtil.Array(queue, "items").OfType<JsonObject>())
            {
                items.Add((JsonNode?)BuildQueueSummaryItem(package, item));
            }
            return new JsonObject
            {
                ["queued"] = EffectiveQueueItems(queue).Count,
                ["rawQueued"] = items.Count,
                ["items"] = items
            };
        }
    }

    public JsonObject QueueSaveEntry(int mediaId, int? progress, bool progressProvided, string? status, double? score, bool scoreProvided, string? notes, bool notesProvided)
    {
        lock (storeLock)
        {
            var package = ReadPackageUnlocked();
            var (sourceStatus, currentEntry) = FindEntry(package, mediaId);
            var updated = ApplyEntryUpdate(package, mediaId, progress, progressProvided, status, score, scoreProvided, notes, notesProvided);
            var queue = ReadQueueUnlocked();
            JsonUtil.Array(queue, "items").Add((JsonNode?)new JsonObject
            {
                ["id"] = Guid.NewGuid().ToString("N"),
                ["kind"] = "saveEntry",
                ["mediaId"] = mediaId,
                ["title"] = JsonUtil.String(updated, "title") ?? JsonUtil.String(currentEntry, "title"),
                ["fromStatus"] = sourceStatus,
                ["progress"] = progressProvided ? progress : null,
                ["progressProvided"] = progressProvided,
                ["status"] = status,
                ["score"] = scoreProvided ? score : null,
                ["scoreProvided"] = scoreProvided,
                ["notes"] = notesProvided ? notes : null,
                ["notesProvided"] = notesProvided,
                ["createdAt"] = DateTimeOffset.UtcNow.ToString("O")
            });
            WriteQueueUnlocked(queue);
            WritePackageUnlocked(package);
            return new JsonObject { ["entry"] = updated, ["offline"] = true, ["queued"] = QueueCountUnlocked() };
        }
    }

    public JsonObject QueueDeleteEntry(int entryId)
    {
        lock (storeLock)
        {
            var package = ReadPackageUnlocked();
            var removed = RemoveEntry(package, entry => JsonUtil.Int(entry, "id") == entryId);
            if (removed is null)
            {
                throw new ApiException("Offline entry was not found.", 404);
            }
            var queue = ReadQueueUnlocked();
            JsonUtil.Array(queue, "items").Add((JsonNode?)new JsonObject
            {
                ["id"] = Guid.NewGuid().ToString("N"),
                ["kind"] = "deleteEntry",
                ["entryId"] = entryId,
                ["mediaId"] = JsonUtil.Int(removed, "mediaId"),
                ["title"] = JsonUtil.String(removed, "title"),
                ["fromStatus"] = JsonUtil.String(removed, "status"),
                ["createdAt"] = DateTimeOffset.UtcNow.ToString("O")
            });
            WriteQueueUnlocked(queue);
            WritePackageUnlocked(package);
            return new JsonObject { ["deleted"] = true, ["entryId"] = entryId, ["offline"] = true, ["queued"] = QueueCountUnlocked() };
        }
    }

    public JsonObject QueueBulkStatus(JsonArray ids, string status)
    {
        var entries = new JsonArray();
        foreach (var mediaId in ids.Select(id => id?.GetValue<int>() ?? 0).Where(id => id > 0))
        {
            var payload = QueueSaveEntry(mediaId, null, false, status, null, false, null, false);
            entries.Add(payload["entry"]?.DeepClone());
        }
        return new JsonObject { ["updated"] = entries.Count, ["entries"] = entries, ["offline"] = true, ["queued"] = QueueCount() };
    }

    public JsonObject QueueBulkProgress(JsonArray updates)
    {
        var entries = new JsonArray();
        foreach (var update in updates.OfType<JsonObject>())
        {
            var mediaId = JsonUtil.Int(update, "mediaId") ?? 0;
            var progress = Math.Max(0, JsonUtil.Int(update, "progress") ?? 0);
            if (mediaId <= 0)
            {
                continue;
            }
            var payload = QueueSaveEntry(mediaId, progress, true, null, null, false, null, false);
            entries.Add(payload["entry"]?.DeepClone());
        }
        return new JsonObject { ["updated"] = entries.Count, ["entries"] = entries, ["offline"] = true, ["queued"] = QueueCount() };
    }

    public async Task<JsonObject> SyncQueuedAsync(CancellationToken cancellationToken)
    {
        JsonArray items;
        lock (storeLock)
        {
            items = new JsonArray();
            foreach (var item in EffectiveQueueItems(ReadQueueUnlocked()))
            {
                items.Add((JsonNode?)item.DeepClone());
            }
        }

        var failedItems = new JsonArray();
        var synced = 0;
        var remaining = new JsonArray();
        foreach (var item in items.OfType<JsonObject>())
        {
            try
            {
                var kind = JsonUtil.String(item, "kind");
                if (kind == "saveEntry")
                {
                    await aniList.SaveEntryAsync(
                        JsonUtil.Int(item, "mediaId") ?? throw new ApiException("Queued edit is missing media id.", 400),
                        JsonUtil.Bool(item, "progressProvided") == true ? JsonUtil.Int(item, "progress") : null,
                        JsonUtil.String(item, "status"),
                        JsonUtil.Bool(item, "scoreProvided") == true ? JsonUtil.Double(item, "score") : null,
                        JsonUtil.Bool(item, "notesProvided") == true ? JsonUtil.String(item, "notes") : null,
                        JsonUtil.Bool(item, "notesProvided") == true,
                        cancellationToken);
                }
                else if (kind == "deleteEntry")
                {
                    await aniList.DeleteEntryAsync(JsonUtil.Int(item, "entryId") ?? throw new ApiException("Queued delete is missing entry id.", 400), cancellationToken);
                }
                else
                {
                    throw new ApiException("Queued edit kind is not supported.", 400);
                }
                synced += 1;
            }
            catch (Exception error)
            {
                var failed = item.DeepClone().AsObject();
                failed["error"] = error.Message;
                failedItems.Add((JsonNode?)failed.DeepClone());
                remaining.Add((JsonNode?)failed);
            }
        }

        JsonArray failures;
        lock (storeLock)
        {
            WriteQueueUnlocked(new JsonObject { ["items"] = remaining });
            var package = ReadPackageUnlocked();
            failures = BuildQueueSummaryItems(package, failedItems);
        }
        return new JsonObject
        {
            ["synced"] = synced,
            ["failed"] = failures.Count,
            ["failures"] = failures,
            ["queued"] = failures.Count
        };
    }

    public JsonObject DiscardQueued()
    {
        lock (storeLock)
        {
            WriteQueueUnlocked(new JsonObject { ["items"] = new JsonArray() });
            return StatusUnlocked();
        }
    }

    public async Task<JsonObject> DisableAsync(bool syncQueued, bool discardQueued, bool removeData, CancellationToken cancellationToken)
    {
        JsonObject? sync = null;
        if (discardQueued)
        {
            DiscardQueued();
        }
        if (syncQueued && QueueCount() > 0)
        {
            sync = await SyncQueuedAsync(cancellationToken);
            if (JsonUtil.Int(sync, "failed") > 0)
            {
                var blocked = Status();
                blocked["disabled"] = false;
                blocked["sync"] = sync;
                blocked["message"] = "Offline Mode stayed enabled because some queued edits failed to sync.";
                return blocked;
            }
        }

        lock (storeLock)
        {
            WriteStateUnlocked(false);
            if (removeData)
            {
                if (Directory.Exists(paths.OfflineImagesDir))
                {
                    Directory.Delete(paths.OfflineImagesDir, true);
                }
                Directory.CreateDirectory(paths.OfflineImagesDir);
                if (File.Exists(paths.OfflinePackagePath))
                {
                    File.Delete(paths.OfflinePackagePath);
                }
                if (File.Exists(paths.OfflineQueuePath))
                {
                    File.Delete(paths.OfflineQueuePath);
                }
            }
            var status = StatusUnlocked();
            status["disabled"] = true;
            if (sync is not null)
            {
                status["sync"] = sync;
            }
            return status;
        }
    }

    private async Task RunEnableAsync(EnableJob job)
    {
        try
        {
            job.Update("lists", 0, PackageStatuses.Length, "Loading AniList lists...");
            var lists = new JsonObject();
            JsonObject? user = null;
            var allEntries = new List<JsonObject>();
            for (var index = 0; index < PackageStatuses.Length; index += 1)
            {
                var status = PackageStatuses[index];
                job.Update("lists", index + 1, PackageStatuses.Length, $"Loading {status}...");
                var payload = await aniList.GetListEntriesAsync(status, "ANIME");
                user ??= payload.Viewer.DeepClone().AsObject();
                var entries = payload.Entries.DeepClone().AsArray();
                lists[status] = new JsonObject
                {
                    ["status"] = status,
                    ["type"] = "ANIME",
                    ["listName"] = payload.ListName,
                    ["entries"] = entries.DeepClone()
                };
                allEntries.AddRange(entries.OfType<JsonObject>().Select(entry => entry.DeepClone().AsObject()));
            }

            var availabilityById = BuildPackagedAvailability(allEntries);
            var ratingsById = BuildPackagedRatings(allEntries);
            var missingAvailability = allEntries.Count(entry => availabilityById[MediaKey(entry)] is null);
            var missingRatings = allEntries.Count(entry => JsonUtil.Int(entry, "malId") is not null && ratingsById[MediaKey(entry)] is null);

            Directory.CreateDirectory(paths.OfflineImagesDir);
            foreach (var existing in Directory.EnumerateFiles(paths.OfflineImagesDir))
            {
                File.Delete(existing);
            }

            var imageMap = await DownloadImagesAsync(allEntries, job);
            var imageFailures = RewriteImageUrls(lists, imageMap);
            var package = new JsonObject
            {
                ["version"] = 1,
                ["createdAt"] = DateTimeOffset.UtcNow.ToString("O"),
                ["user"] = user ?? new JsonObject(),
                ["lists"] = lists,
                ["availability"] = availabilityById,
                ["ratings"] = ratingsById,
                ["stats"] = new JsonObject
                {
                    ["entryCount"] = allEntries.Count,
                    ["statuses"] = PackageStatuses.Length,
                    ["missingAvailability"] = missingAvailability,
                    ["missingRatings"] = missingRatings,
                    ["imageFailures"] = imageFailures
                }
            };

            lock (storeLock)
            {
                WritePackageUnlocked(package);
                WriteQueueUnlocked(new JsonObject { ["items"] = new JsonArray() });
                WriteStateUnlocked(true);
            }
            job.Complete(Status());
        }
        catch (Exception error)
        {
            job.Fail(error.Message);
        }
    }

    private JsonObject BuildPackagedAvailability(IEnumerable<JsonObject> entries)
    {
        var source = availability.ReadCache();
        var result = new JsonObject();
        foreach (var entry in entries)
        {
            var key = MediaKey(entry);
            if (source[key] is JsonObject cached && JsonUtil.String(cached, "status") == "found")
            {
                result[key] = cached.DeepClone();
            }
        }
        return result;
    }

    private JsonObject BuildPackagedRatings(IEnumerable<JsonObject> entries)
    {
        var malCache = JsonUtil.ReadObject(paths.MalCachePath);
        var result = new JsonObject();
        foreach (var entry in entries)
        {
            var mediaId = JsonUtil.Int(entry, "mediaId");
            var malId = JsonUtil.Int(entry, "malId");
            if (mediaId is null || malId is null || malCache[malId.Value.ToString()] is not JsonObject saved)
            {
                continue;
            }
            if (JsonUtil.String(saved, "status") != "found" || !saved.ContainsKey("rating") || !saved.ContainsKey("ratingLabel"))
            {
                continue;
            }
            result[mediaId.Value.ToString()] = new JsonObject
            {
                ["mediaId"] = mediaId,
                ["malId"] = malId,
                ["rating"] = JsonUtil.String(saved, "rating"),
                ["ratingLabel"] = JsonUtil.String(saved, "ratingLabel"),
                ["status"] = JsonUtil.String(saved, "status"),
                ["cached"] = true
            };
        }
        return result;
    }

    private async Task<Dictionary<string, string>> DownloadImagesAsync(List<JsonObject> entries, EnableJob job)
    {
        var urls = entries
            .SelectMany(entry => new[] { JsonUtil.String(entry, "coverImage"), JsonUtil.String(entry, "coverImageLarge") })
            .Where(url => Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            .Select(url => url!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < urls.Length; index += 1)
        {
            var url = urls[index];
            job.Update("images", index + 1, urls.Length, $"Downloading images {index + 1}/{urls.Length}...");
            try
            {
                using var response = await http.GetAsync(url);
                if (!response.IsSuccessStatusCode)
                {
                    continue;
                }
                var bytes = await response.Content.ReadAsByteArrayAsync();
                if (bytes.Length == 0)
                {
                    continue;
                }
                var extension = ImageExtension(response.Content.Headers.ContentType?.MediaType, url);
                var fileName = $"{Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(url))).ToLowerInvariant()}{extension}";
                await File.WriteAllBytesAsync(Path.Combine(paths.OfflineImagesDir, fileName), bytes);
                map[url] = $"/api/offline/images/{fileName}";
            }
            catch
            {
                // Missing images are reported in package stats; remote URLs are still removed.
            }
        }
        return map;
    }

    private static int RewriteImageUrls(JsonObject lists, Dictionary<string, string> imageMap)
    {
        var failures = 0;
        foreach (var list in lists.Select(item => item.Value).OfType<JsonObject>())
        {
            foreach (var entry in (list["entries"] as JsonArray ?? []).OfType<JsonObject>())
            {
                failures += RewriteImageUrl(entry, "coverImage", imageMap);
                failures += RewriteImageUrl(entry, "coverImageLarge", imageMap);
            }
        }
        return failures;
    }

    private static int RewriteImageUrl(JsonObject entry, string property, Dictionary<string, string> imageMap)
    {
        var url = JsonUtil.String(entry, property);
        if (string.IsNullOrWhiteSpace(url))
        {
            entry[property] = null;
            return 0;
        }
        if (imageMap.TryGetValue(url, out var localUrl))
        {
            entry[property] = localUrl;
            return 0;
        }
        entry[property] = null;
        return 1;
    }

    private JsonObject ApplyEntryUpdate(JsonObject package, int mediaId, int? progress, bool progressProvided, string? status, double? score, bool scoreProvided, string? notes, bool notesProvided)
    {
        var (currentStatus, entry) = FindEntry(package, mediaId);
        if (entry is null || currentStatus is null)
        {
            throw new ApiException("Offline entry was not found.", 404);
        }
        var updated = entry.DeepClone().AsObject();
        if (progressProvided)
        {
            updated["progress"] = Math.Max(0, progress ?? 0);
        }
        if (scoreProvided)
        {
            updated["score"] = Math.Max(0, score ?? 0);
        }
        if (notesProvided)
        {
            updated["notes"] = notes ?? "";
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            updated["status"] = status;
            if (status != currentStatus)
            {
                RemoveEntry(package, candidate => JsonUtil.Int(candidate, "mediaId") == mediaId);
                var targetList = package["lists"]?[status] as JsonObject ?? EnsureList(package, status);
                JsonUtil.Array(targetList, "entries").Add(updated.DeepClone());
                SortEntries(targetList);
                return updated;
            }
        }
        ReplaceEntry(package, mediaId, updated);
        return updated;
    }

    private static (string? Status, JsonObject? Entry) FindEntry(JsonObject package, int mediaId)
    {
        foreach (var item in (package["lists"] as JsonObject ?? new JsonObject()))
        {
            if (item.Value is not JsonObject list)
            {
                continue;
            }
            foreach (var entry in (list["entries"] as JsonArray ?? []).OfType<JsonObject>())
            {
                if (JsonUtil.Int(entry, "mediaId") == mediaId)
                {
                    return (item.Key, entry);
                }
            }
        }
        return (null, null);
    }

    private static JsonObject BuildQueueSummaryItem(JsonObject package, JsonObject item)
    {
        var mediaId = JsonUtil.Int(item, "mediaId");
        var entryId = JsonUtil.Int(item, "entryId");
        var title = JsonUtil.String(item, "title") ?? FindPackagedTitle(package, mediaId);
        if (string.IsNullOrWhiteSpace(title))
        {
            title = mediaId is > 0 ? $"AniList #{mediaId}" : entryId is > 0 ? $"Entry #{entryId}" : "Queued item";
        }

        var details = QueueDetails(item);
        return new JsonObject
        {
            ["id"] = JsonUtil.String(item, "id"),
            ["kind"] = JsonUtil.String(item, "kind"),
            ["mediaId"] = mediaId,
            ["entryId"] = entryId,
            ["title"] = title,
            ["createdAt"] = JsonUtil.String(item, "createdAt"),
            ["summary"] = details.Count > 0 ? details[0]?.GetValue<string>() : "Queued change",
            ["details"] = details,
            ["error"] = JsonUtil.String(item, "error")
        };
    }

    private static JsonArray BuildQueueSummaryItems(JsonObject package, JsonArray sourceItems)
    {
        var items = new JsonArray();
        foreach (var item in sourceItems.OfType<JsonObject>())
        {
            items.Add((JsonNode?)BuildQueueSummaryItem(package, item));
        }
        return items;
    }

    private static JsonArray QueueDetails(JsonObject item)
    {
        var details = new JsonArray();
        var kind = JsonUtil.String(item, "kind");
        if (kind == "deleteEntry")
        {
            details.Add((JsonNode?)JsonValue.Create("Remove from list"));
            return details;
        }

        if (JsonUtil.Bool(item, "progressProvided") == true)
        {
            details.Add((JsonNode?)JsonValue.Create($"Progress -> {JsonUtil.Int(item, "progress") ?? 0}"));
        }
        if (JsonUtil.Bool(item, "scoreProvided") == true)
        {
            details.Add((JsonNode?)JsonValue.Create($"Score -> {(JsonUtil.Double(item, "score") ?? 0):g}"));
        }
        var status = JsonUtil.String(item, "status");
        if (!string.IsNullOrWhiteSpace(status))
        {
            details.Add((JsonNode?)JsonValue.Create($"Move -> {StatusLabel(status)}"));
        }
        if (JsonUtil.Bool(item, "notesProvided") == true)
        {
            details.Add((JsonNode?)JsonValue.Create("Notes updated"));
        }
        if (details.Count == 0)
        {
            details.Add((JsonNode?)JsonValue.Create("Queued change"));
        }
        return details;
    }

    private static string? FindPackagedTitle(JsonObject package, int? mediaId)
    {
        if (mediaId is null or <= 0)
        {
            return null;
        }
        var (_, entry) = FindEntry(package, mediaId.Value);
        return JsonUtil.String(entry, "title");
    }

    private static string StatusLabel(string status) => status switch
    {
        "CURRENT" => "Watching",
        "PLANNING" => "Planning",
        "COMPLETED" => "Completed",
        "PAUSED" => "Paused",
        "DROPPED" => "Dropped",
        "REPEATING" => "Repeating",
        _ => status
    };

    private static void ReplaceEntry(JsonObject package, int mediaId, JsonObject updated)
    {
        foreach (var list in (package["lists"] as JsonObject ?? new JsonObject()).Select(item => item.Value).OfType<JsonObject>())
        {
            var entries = list["entries"] as JsonArray ?? new JsonArray();
            for (var index = 0; index < entries.Count; index += 1)
            {
                if (entries[index] is JsonObject entry && JsonUtil.Int(entry, "mediaId") == mediaId)
                {
                    entries[index] = updated.DeepClone();
                    SortEntries(list);
                    return;
                }
            }
        }
    }

    private static JsonObject? RemoveEntry(JsonObject package, Func<JsonObject, bool> predicate)
    {
        foreach (var list in (package["lists"] as JsonObject ?? new JsonObject()).Select(item => item.Value).OfType<JsonObject>())
        {
            var entries = list["entries"] as JsonArray ?? new JsonArray();
            for (var index = entries.Count - 1; index >= 0; index -= 1)
            {
                if (entries[index] is JsonObject entry && predicate(entry))
                {
                    var removed = entry.DeepClone().AsObject();
                    entries.RemoveAt(index);
                    return removed;
                }
            }
        }
        return null;
    }

    private static JsonObject EnsureList(JsonObject package, string status)
    {
        var lists = package["lists"] as JsonObject ?? new JsonObject();
        package["lists"] = lists;
        var list = new JsonObject
        {
            ["status"] = status,
            ["type"] = "ANIME",
            ["listName"] = status,
            ["entries"] = new JsonArray()
        };
        lists[status] = list;
        return list;
    }

    private static void SortEntries(JsonObject list)
    {
        var entries = list["entries"] as JsonArray;
        if (entries is null)
        {
            return;
        }
        var sorted = entries.OfType<JsonObject>()
            .OrderBy(entry => JsonUtil.String(entry, "title"), StringComparer.CurrentCulture)
            .Select(entry => entry.DeepClone())
            .ToArray();
        entries.Clear();
        foreach (var entry in sorted)
        {
            entries.Add(entry);
        }
    }

    private int QueueCount()
    {
        lock (storeLock)
        {
            return QueueCountUnlocked();
        }
    }

    private JsonObject StatusUnlocked()
    {
        var package = ReadPackageUnlocked();
        var stats = package["stats"] as JsonObject ?? new JsonObject();
        return new JsonObject
        {
            ["enabled"] = JsonUtil.Bool(JsonUtil.ReadObject(paths.OfflineStatePath), "enabled") == true && File.Exists(paths.OfflinePackagePath),
            ["packagePresent"] = File.Exists(paths.OfflinePackagePath),
            ["queued"] = QueueCountUnlocked(),
            ["createdAt"] = JsonUtil.String(package, "createdAt"),
            ["entryCount"] = JsonUtil.Int(stats, "entryCount") ?? 0,
            ["missingAvailability"] = JsonUtil.Int(stats, "missingAvailability") ?? 0,
            ["missingRatings"] = JsonUtil.Int(stats, "missingRatings") ?? 0,
            ["imageFailures"] = JsonUtil.Int(stats, "imageFailures") ?? 0,
            ["user"] = package["user"]?.DeepClone()
        };
    }

    private JsonObject ReadPackageUnlocked() => JsonUtil.ReadObject(paths.OfflinePackagePath);

    private void WritePackageUnlocked(JsonObject package)
    {
        Directory.CreateDirectory(paths.OfflineDir);
        File.WriteAllText(paths.OfflinePackagePath, package.ToJsonString(JsonUtil.WriterOptions));
    }

    private JsonObject ReadQueueUnlocked()
    {
        var queue = JsonUtil.ReadObject(paths.OfflineQueuePath);
        if (queue["items"] is not JsonArray)
        {
            queue["items"] = new JsonArray();
        }
        return queue;
    }

    private void WriteQueueUnlocked(JsonObject queue)
    {
        Directory.CreateDirectory(paths.OfflineDir);
        File.WriteAllText(paths.OfflineQueuePath, queue.ToJsonString(JsonUtil.WriterOptions));
    }

    private int QueueCountUnlocked() => EffectiveQueueItems(ReadQueueUnlocked()).Count;

    private static List<JsonObject> EffectiveQueueItems(JsonObject queue)
    {
        var compacted = new List<JsonObject>();
        foreach (var item in JsonUtil.Array(queue, "items").OfType<JsonObject>())
        {
            var candidate = item.DeepClone().AsObject();
            var kind = JsonUtil.String(candidate, "kind");
            var mediaId = JsonUtil.Int(candidate, "mediaId");
            if (kind == "deleteEntry")
            {
                if (mediaId is not null)
                {
                    compacted.RemoveAll(existing =>
                        JsonUtil.String(existing, "kind") == "saveEntry" &&
                        JsonUtil.Int(existing, "mediaId") == mediaId);
                }
                var entryId = JsonUtil.Int(candidate, "entryId");
                compacted.RemoveAll(existing =>
                    JsonUtil.String(existing, "kind") == "deleteEntry" &&
                    JsonUtil.Int(existing, "entryId") == entryId &&
                    entryId is not null);
                compacted.Add(candidate);
                continue;
            }

            if (kind == "saveEntry" && mediaId is not null)
            {
                var existing = compacted.LastOrDefault(saved =>
                    JsonUtil.String(saved, "kind") == "saveEntry" &&
                    JsonUtil.Int(saved, "mediaId") == mediaId);
                if (existing is not null)
                {
                    MergeSaveEntry(existing, candidate);
                    continue;
                }
            }

            compacted.Add(candidate);
        }
        return compacted;
    }

    private static void MergeSaveEntry(JsonObject existing, JsonObject incoming)
    {
        existing["id"] = JsonUtil.String(incoming, "id") ?? JsonUtil.String(existing, "id");
        existing["title"] = JsonUtil.String(incoming, "title") ?? JsonUtil.String(existing, "title");
        existing["createdAt"] = JsonUtil.String(incoming, "createdAt") ?? JsonUtil.String(existing, "createdAt");
        if (existing["fromStatus"] is null)
        {
            existing["fromStatus"] = JsonUtil.String(incoming, "fromStatus");
        }
        if (JsonUtil.Bool(incoming, "progressProvided") == true)
        {
            existing["progress"] = JsonUtil.Int(incoming, "progress");
            existing["progressProvided"] = true;
        }
        if (JsonUtil.Bool(incoming, "scoreProvided") == true)
        {
            existing["score"] = JsonUtil.Double(incoming, "score");
            existing["scoreProvided"] = true;
        }
        if (incoming.ContainsKey("status") && !string.IsNullOrWhiteSpace(JsonUtil.String(incoming, "status")))
        {
            existing["status"] = JsonUtil.String(incoming, "status");
        }
        if (JsonUtil.Bool(incoming, "notesProvided") == true)
        {
            existing["notes"] = JsonUtil.String(incoming, "notes");
            existing["notesProvided"] = true;
        }
    }

    private void WriteStateUnlocked(bool enabled)
    {
        Directory.CreateDirectory(paths.OfflineDir);
        File.WriteAllText(paths.OfflineStatePath, new JsonObject
        {
            ["enabled"] = enabled,
            ["updatedAt"] = DateTimeOffset.UtcNow.ToString("O")
        }.ToJsonString(JsonUtil.WriterOptions));
    }

    private static string MediaKey(JsonObject entry) => (JsonUtil.Int(entry, "mediaId") ?? 0).ToString();

    private static string ImageExtension(string? mediaType, string url)
    {
        if (mediaType?.Contains("png", StringComparison.OrdinalIgnoreCase) == true)
        {
            return ".png";
        }
        if (mediaType?.Contains("webp", StringComparison.OrdinalIgnoreCase) == true)
        {
            return ".webp";
        }
        if (mediaType?.Contains("gif", StringComparison.OrdinalIgnoreCase) == true)
        {
            return ".gif";
        }
        var extension = Path.GetExtension(Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.AbsolutePath : url).ToLowerInvariant();
        return extension is ".png" or ".webp" or ".gif" or ".jpg" or ".jpeg" ? extension : ".jpg";
    }

    private static string ImageContentType(string extension) => extension.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        ".gif" => "image/gif",
        _ => "image/jpeg"
    };

    private sealed class EnableJob(string id)
    {
        private readonly object jobLock = new();
        private string state = "running";
        private string phase = "starting";
        private string message = "Starting Offline Mode packaging...";
        private int checkedCount;
        private int total;
        private string? error;
        private JsonObject? result;

        public string Id { get; } = id;

        public void Update(string nextPhase, int nextChecked, int nextTotal, string nextMessage)
        {
            lock (jobLock)
            {
                phase = nextPhase;
                checkedCount = nextChecked;
                total = nextTotal;
                message = nextMessage;
            }
        }

        public void Complete(JsonObject status)
        {
            lock (jobLock)
            {
                state = "completed";
                phase = "completed";
                message = "Offline Mode is ready.";
                result = status.DeepClone().AsObject();
            }
        }

        public void Fail(string nextError)
        {
            lock (jobLock)
            {
                state = "error";
                phase = "error";
                message = nextError;
                error = nextError;
            }
        }

        public JsonObject ToJson()
        {
            lock (jobLock)
            {
                return new JsonObject
                {
                    ["jobId"] = Id,
                    ["state"] = state,
                    ["phase"] = phase,
                    ["checked"] = checkedCount,
                    ["total"] = total,
                    ["message"] = message,
                    ["error"] = error,
                    ["result"] = result?.DeepClone()
                };
            }
        }
    }
}
