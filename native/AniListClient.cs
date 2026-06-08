using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed class ApiException(string message, int status = 500, JsonNode? details = null) : Exception(message)
{
    public int Status { get; } = status;
    public JsonNode? Details { get; } = details;
}

internal sealed class AniListClient(HttpClient http, TokenStore tokens)
{
    private const string GraphQlUrl = "https://graphql.anilist.co";
    private static readonly TimeSpan ListCacheTtl = TimeSpan.FromMinutes(2);
    private readonly SemaphoreSlim mutationLock = new(1, 1);
    private readonly object listCacheLock = new();
    private readonly Dictionary<string, CachedListResult> listCache = new(StringComparer.OrdinalIgnoreCase);
    private DateTimeOffset nextMutationAt = DateTimeOffset.MinValue;

    public const string ViewerQuery = """
        query Viewer {
          Viewer {
            id
            name
            siteUrl
            avatar { large }
          }
        }
        """;

    private const string ListQuery = """
        query AnimeLists($userId: Int!, $type: MediaType!, $status: MediaListStatus!, $chunk: Int, $perChunk: Int) {
          MediaListCollection(userId: $userId, type: $type, status: $status, forceSingleCompletedList: true, chunk: $chunk, perChunk: $perChunk) {
            hasNextChunk
            lists {
              name
              status
              isCustomList
              entries {
                id
                status
                progress
                score
                notes
                updatedAt
                startedAt { year month day }
                completedAt { year month day }
                repeat
                priority
                customLists
                media {
                  id
                  idMal
                  episodes
                  status
                  endDate { year month day }
                  seasonYear
                  format
                  isAdult
                  siteUrl
                  averageScore
                  title { romaji english native }
                  description(asHtml: true)
                  genres
                  synonyms
                  coverImage { extraLarge large medium color }
                  nextAiringEpisode {
                    episode
                    airingAt
                    timeUntilAiring
                  }
                }
              }
            }
          }
        }
        """;

    private sealed record CachedListResult(JsonObject Viewer, string ListName, JsonArray Entries, JsonObject Diagnostics, DateTimeOffset CachedAt);

    private const string SaveEntryMutation = """
        mutation SaveEntry($mediaId: Int!, $progress: Int, $status: MediaListStatus, $score: Float) {
          SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, score: $score) {
            id
            status
            progress
            score
            notes
            updatedAt
            startedAt { year month day }
            completedAt { year month day }
            repeat
            priority
            customLists
            media {
              id
              idMal
              episodes
              status
              endDate { year month day }
              seasonYear
              format
              isAdult
              siteUrl
              averageScore
              title { romaji english native }
              description(asHtml: true)
              genres
              synonyms
              coverImage { extraLarge large medium color }
              nextAiringEpisode {
                episode
                airingAt
                timeUntilAiring
              }
            }
          }
        }
        """;

    private const string SaveEntryWithNotesMutation = """
        mutation SaveEntryWithNotes($mediaId: Int!, $progress: Int, $status: MediaListStatus, $score: Float, $notes: String) {
          SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, score: $score, notes: $notes) {
            id
            status
            progress
            score
            notes
            updatedAt
            startedAt { year month day }
            completedAt { year month day }
            repeat
            priority
            customLists
            media {
              id
              idMal
              episodes
              status
              endDate { year month day }
              seasonYear
              format
              isAdult
              siteUrl
              averageScore
              title { romaji english native }
              description(asHtml: true)
              genres
              synonyms
              coverImage { extraLarge large medium color }
              nextAiringEpisode {
                episode
                airingAt
                timeUntilAiring
              }
            }
          }
        }
        """;

    private const string SaveEntryFullMutation = """
        mutation SaveEntryFull($mediaId: Int!, $progress: Int, $status: MediaListStatus, $score: Float, $notes: String, $customLists: [String]) {
          SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status, score: $score, notes: $notes, customLists: $customLists) {
            id
            status
            progress
            score
            notes
            updatedAt
            startedAt { year month day }
            completedAt { year month day }
            repeat
            priority
            customLists
            media {
              id
              idMal
              episodes
              status
              endDate { year month day }
              seasonYear
              format
              isAdult
              siteUrl
              averageScore
              title { romaji english native }
              description(asHtml: true)
              genres
              synonyms
              coverImage { extraLarge large medium color }
              nextAiringEpisode {
                episode
                airingAt
                timeUntilAiring
              }
            }
          }
        }
        """;

    private const string UserListOptionsQuery = """
        query UserListOptions {
          Viewer {
            mediaListOptions {
              animeList {
                customLists
              }
            }
          }
        }
        """;

    private const string UpdateCustomListsMutation = """
        mutation UpdateCustomLists($customLists: [String]) {
          UpdateUser(animeListOptions: { customLists: $customLists }) {
            mediaListOptions {
              animeList {
                customLists
              }
            }
          }
        }
        """;

    private const string DeleteCustomListMutation = """
        mutation DeleteCustomList($customList: String, $type: MediaType) {
          DeleteCustomList(customList: $customList, type: $type) {
            deleted
          }
        }
        """;

    private const string DeleteEntryMutation = """
        mutation DeleteEntry($id: Int!) {
          DeleteMediaListEntry(id: $id) {
            deleted
          }
        }
        """;

    private const string AnimeSearchQuery = """
        query AnimeSearch($query: String!, $page: Int!, $perPage: Int!) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
              currentPage
              lastPage
              hasNextPage
              perPage
            }
            media(search: $query, type: ANIME, sort: SEARCH_MATCH) {
              id
              idMal
              episodes
              status
              endDate { year month day }
              seasonYear
              format
              isAdult
              siteUrl
              averageScore
              title { romaji english native }
              description(asHtml: true)
              genres
              synonyms
              coverImage { extraLarge large medium color }
              nextAiringEpisode {
                episode
                airingAt
                timeUntilAiring
              }
              mediaListEntry {
                id
                status
                progress
                score
              }
            }
          }
        }
        """;

    public async Task<JsonObject> GraphQlAsync(string query, JsonObject? variables = null, string? explicitToken = null, CancellationToken cancellationToken = default)
    {
        var token = explicitToken ?? tokens.Resolve().Token;
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new ApiException("AniList token is missing. Open Settings to save or import a token.", 401);
        }

        var body = new JsonObject
        {
            ["query"] = query,
            ["variables"] = variables?.DeepClone() ?? new JsonObject()
        };
        for (var attempt = 0; attempt < 5; attempt += 1)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, GraphQlUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");

            HttpResponseMessage response;
            try
            {
                response = await http.SendAsync(request, cancellationToken);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new ApiException("AniList request timed out before the local app received a response.", 504, new JsonObject
                {
                    ["source"] = "anilist",
                    ["endpoint"] = GraphQlUrl,
                    ["timeoutMs"] = (long)http.Timeout.TotalMilliseconds,
                    ["attempt"] = attempt + 1
                });
            }
            catch (HttpRequestException error)
            {
                throw new ApiException("AniList request could not reach the remote API.", 502, new JsonObject
                {
                    ["source"] = "anilist",
                    ["endpoint"] = GraphQlUrl,
                    ["message"] = error.Message,
                    ["attempt"] = attempt + 1
                });
            }
            using (response)
            {
                var text = await response.Content.ReadAsStringAsync(cancellationToken);
                var payload = JsonNode.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text) as JsonObject ?? new JsonObject();
                var errors = payload["errors"] as JsonArray;
                if (response.IsSuccessStatusCode && errors is not { Count: > 0 })
                {
                    return payload["data"] as JsonObject ?? new JsonObject();
                }

                var message = errors is { Count: > 0 }
                    ? string.Join("; ", errors.Select(error => JsonUtil.String(error, "message")).Where(value => !string.IsNullOrWhiteSpace(value)))
                    : $"AniList request failed with {(int)response.StatusCode}";
                message = string.IsNullOrWhiteSpace(message) ? "AniList request failed." : message;
                if (IsRateLimited(response, message) && attempt < 4)
                {
                    await Task.Delay(RateLimitDelay(response, attempt), cancellationToken);
                    continue;
                }

                throw new ApiException(message, (int)response.StatusCode, errors);
            }
        }

        throw new ApiException("AniList request failed after retrying.", 429);
    }

    public async Task<JsonObject> ViewerAsync(string? token = null, CancellationToken cancellationToken = default)
    {
        var data = await GraphQlAsync(ViewerQuery, null, token, cancellationToken);
        return (data["Viewer"] as JsonObject)?.DeepClone().AsObject() ?? new JsonObject();
    }

    public async Task<JsonArray> CustomListsAsync(CancellationToken cancellationToken = default)
    {
        var data = await GraphQlAsync(UserListOptionsQuery, cancellationToken: cancellationToken);
        return ExtractCustomLists(data["Viewer"] as JsonObject);
    }

    public async Task<JsonArray> CreateCustomListAsync(string name, string type, CancellationToken cancellationToken = default)
    {
        if (!string.Equals(type, "ANIME", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("Only ANIME lists are supported.", 400);
        }
        var normalizedName = ListMetadataStore.NormalizeCustomListName(name);
        return await RunMutationAsync(async () =>
        {
            var existing = await CustomListsAsync(cancellationToken);
            var next = existing
                .Select(node => node?.GetValue<string>() ?? "")
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .ToList();
            if (!next.Contains(normalizedName, StringComparer.OrdinalIgnoreCase))
            {
                next.Add(normalizedName);
            }
            var variables = new JsonObject { ["customLists"] = ToJsonArray(next) };
            var data = await GraphQlAsync(UpdateCustomListsMutation, variables, cancellationToken: cancellationToken);
            ClearListCache();
            return ExtractCustomLists(data["UpdateUser"] as JsonObject);
        }, cancellationToken);
    }

    public async Task<JsonArray> DeleteCustomListAsync(string name, string type, CancellationToken cancellationToken = default)
    {
        if (!string.Equals(type, "ANIME", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("Only ANIME lists are supported.", 400);
        }
        var normalizedName = ListMetadataStore.NormalizeCustomListName(name);
        return await RunMutationAsync(async () =>
        {
            var existing = await CustomListsAsync(cancellationToken);
            var remaining = existing
                .Select(node => node?.GetValue<string>() ?? "")
                .Where(value => !string.IsNullOrWhiteSpace(value) && !string.Equals(value, normalizedName, StringComparison.OrdinalIgnoreCase))
                .ToList();
            var data = await GraphQlAsync(DeleteCustomListMutation, new JsonObject
            {
                ["customList"] = normalizedName,
                ["type"] = "ANIME"
            }, cancellationToken: cancellationToken);
            if (JsonUtil.Bool(data["DeleteCustomList"], "deleted") != true)
            {
                throw new ApiException("AniList did not confirm the custom list was deleted.", 502);
            }
            var updateData = await GraphQlAsync(UpdateCustomListsMutation, new JsonObject
            {
                ["customLists"] = ToJsonArray(remaining)
            }, cancellationToken: cancellationToken);
            ClearListCache();
            return ExtractCustomLists(updateData["UpdateUser"] as JsonObject);
        }, cancellationToken);
    }

    public async Task<(JsonObject Viewer, string ListName, JsonArray Entries, JsonObject Diagnostics)> GetListEntriesAsync(string status, string type, int? chunk = null, int? perChunk = null, CancellationToken cancellationToken = default)
    {
        var cacheKey = chunk.HasValue || perChunk.HasValue
            ? $"{type}:{status}:chunk:{chunk ?? 0}:per:{perChunk ?? 0}"
            : $"{type}:{status}";
        if (TryGetCachedList(cacheKey) is { } cached)
        {
            return cached;
        }

        var totalTimer = Stopwatch.StartNew();
        var viewerTimer = Stopwatch.StartNew();
        var viewerData = await GraphQlAsync(ViewerQuery, cancellationToken: cancellationToken);
        viewerTimer.Stop();
        var viewer = (viewerData["Viewer"] as JsonObject)?.DeepClone().AsObject() ?? new JsonObject();
        var userId = JsonUtil.Int(viewer, "id") ?? throw new ApiException("AniList viewer id was missing.", 502);
        var collectionTimer = Stopwatch.StartNew();
        var variables = new JsonObject { ["userId"] = userId, ["type"] = type, ["status"] = status };
        if (chunk.HasValue)
        {
            variables["chunk"] = chunk.Value;
        }
        if (perChunk.HasValue)
        {
            variables["perChunk"] = perChunk.Value;
        }
        var data = await GraphQlAsync(ListQuery, variables, cancellationToken: cancellationToken);
        collectionTimer.Stop();
        var normalizeTimer = Stopwatch.StartNew();
        var collection = data["MediaListCollection"] as JsonObject ?? new JsonObject();
        var lists = collection["lists"] as JsonArray ?? [];
        JsonObject? selectedList = null;
        foreach (var list in lists.OfType<JsonObject>())
        {
            if (JsonUtil.String(list, "status") == status)
            {
                selectedList = list;
                break;
            }
        }

        var entries = new JsonArray();
        foreach (var entry in (selectedList?["entries"] as JsonArray ?? []).OfType<JsonObject>())
        {
            entries.Add((JsonNode?)NormalizeEntry(entry));
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

        normalizeTimer.Stop();
        totalTimer.Stop();
        var diagnostics = new JsonObject
        {
            ["source"] = "anilist",
            ["cacheHit"] = false,
            ["viewerMs"] = viewerTimer.ElapsedMilliseconds,
            ["collectionMs"] = collectionTimer.ElapsedMilliseconds,
            ["remoteMs"] = viewerTimer.ElapsedMilliseconds + collectionTimer.ElapsedMilliseconds,
            ["localNormalizeMs"] = normalizeTimer.ElapsedMilliseconds,
            ["totalClientMs"] = totalTimer.ElapsedMilliseconds,
            ["listCount"] = lists.Count,
            ["entryCount"] = entries.Count,
            ["selectedStatus"] = status,
            ["hasNextChunk"] = JsonUtil.Bool(collection, "hasNextChunk") == true
        };
        if (chunk.HasValue)
        {
            diagnostics["chunk"] = chunk.Value;
        }
        if (perChunk.HasValue)
        {
            diagnostics["perChunk"] = perChunk.Value;
        }
        StoreCachedList(cacheKey, viewer, JsonUtil.String(selectedList, "name") ?? status, entries, diagnostics);
        return CloneListResult(viewer, JsonUtil.String(selectedList, "name") ?? status, entries, diagnostics);
    }

    public async Task<JsonObject> SearchAnimeAsync(string query, int page, int perPage, CancellationToken cancellationToken = default)
    {
        var variables = new JsonObject
        {
            ["query"] = query,
            ["page"] = Math.Max(1, page),
            ["perPage"] = Math.Clamp(perPage, 1, 50)
        };
        var data = await GraphQlAsync(AnimeSearchQuery, variables, cancellationToken: cancellationToken);
        var pageObject = data["Page"] as JsonObject ?? new JsonObject();
        var entries = new JsonArray();
        foreach (var media in (pageObject["media"] as JsonArray ?? []).OfType<JsonObject>())
        {
            entries.Add((JsonNode?)NormalizeSearchMedia(media));
        }

        return new JsonObject
        {
            ["pageInfo"] = pageObject["pageInfo"]?.DeepClone() ?? new JsonObject(),
            ["entries"] = entries
        };
    }

    public async Task<JsonObject> SaveEntryAsync(int mediaId, int? progress, string? status, double? score = null, string? notes = null, bool notesProvided = false, IReadOnlyList<string>? customLists = null, bool customListsProvided = false, CancellationToken cancellationToken = default)
    {
        var variables = new JsonObject { ["mediaId"] = mediaId };
        if (progress.HasValue)
        {
            variables["progress"] = progress.Value;
        }
        if (!string.IsNullOrWhiteSpace(status))
        {
            variables["status"] = status;
        }
        if (score.HasValue)
        {
            variables["score"] = score.Value;
        }
        if (notesProvided)
        {
            variables["notes"] = string.IsNullOrWhiteSpace(notes) ? null : notes;
        }
        if (customListsProvided)
        {
            var customListArray = new JsonArray();
            foreach (var customList in customLists ?? [])
            {
                customListArray.Add((JsonNode?)JsonValue.Create(customList));
            }
            variables["customLists"] = customListArray;
        }

        return await RunMutationAsync(async () =>
        {
            var mutation = customListsProvided
                ? SaveEntryFullMutation
                : notesProvided
                    ? SaveEntryWithNotesMutation
                    : SaveEntryMutation;
            var data = await GraphQlAsync(mutation, variables, cancellationToken: cancellationToken);
            var entry = data["SaveMediaListEntry"] as JsonObject ?? throw new ApiException("AniList did not return the updated entry.", 502);
            ClearListCache();
            return NormalizeEntry(entry);
        }, cancellationToken);
    }

    public async Task<JsonArray> SaveProgressEntriesAsync(IReadOnlyList<(int MediaId, int Progress)> updates, CancellationToken cancellationToken = default)
    {
        var normalizedUpdates = updates
            .Where(update => update.MediaId > 0)
            .Select(update => (update.MediaId, Progress: Math.Max(0, update.Progress)))
            .ToArray();

        if (normalizedUpdates.Length == 0)
        {
            return [];
        }

        return await RunMutationAsync(async () =>
        {
            var data = await GraphQlAsync(BuildBulkProgressMutation(normalizedUpdates), cancellationToken: cancellationToken);
            var entries = new JsonArray();
            for (var index = 0; index < normalizedUpdates.Length; index += 1)
            {
                if (data[$"m{index}"] is JsonObject entry)
                {
                    entries.Add((JsonNode?)NormalizeEntry(entry));
                }
            }
            ClearListCache();
            return entries;
        }, cancellationToken);
    }

    public async Task DeleteEntryAsync(int entryId, CancellationToken cancellationToken = default)
    {
        await RunMutationAsync(async () =>
        {
            var data = await GraphQlAsync(DeleteEntryMutation, new JsonObject { ["id"] = entryId }, cancellationToken: cancellationToken);
            if (JsonUtil.Bool(data["DeleteMediaListEntry"], "deleted") != true)
            {
                throw new ApiException("AniList did not confirm the entry was deleted.", 502);
            }
            ClearListCache();
            return true;
        }, cancellationToken);
    }

    public void ClearListCache()
    {
        lock (listCacheLock)
        {
            listCache.Clear();
        }
    }

    private (JsonObject Viewer, string ListName, JsonArray Entries, JsonObject Diagnostics)? TryGetCachedList(string cacheKey)
    {
        lock (listCacheLock)
        {
            if (!listCache.TryGetValue(cacheKey, out var cached))
            {
                return null;
            }

            var age = DateTimeOffset.UtcNow - cached.CachedAt;
            if (age > ListCacheTtl)
            {
                listCache.Remove(cacheKey);
                return null;
            }

            var diagnostics = cached.Diagnostics.DeepClone().AsObject();
            diagnostics["cacheHit"] = true;
            diagnostics["cacheAgeMs"] = (long)age.TotalMilliseconds;
            diagnostics["remoteMs"] = 0;
            diagnostics["localNormalizeMs"] = 0;
            diagnostics["totalClientMs"] = 0;
            return CloneListResult(cached.Viewer, cached.ListName, cached.Entries, diagnostics);
        }
    }

    private void StoreCachedList(string cacheKey, JsonObject viewer, string listName, JsonArray entries, JsonObject diagnostics)
    {
        lock (listCacheLock)
        {
            listCache[cacheKey] = new CachedListResult(
                viewer.DeepClone().AsObject(),
                listName,
                entries.DeepClone().AsArray(),
                diagnostics.DeepClone().AsObject(),
                DateTimeOffset.UtcNow);
        }
    }

    private static (JsonObject Viewer, string ListName, JsonArray Entries, JsonObject Diagnostics) CloneListResult(JsonObject viewer, string listName, JsonArray entries, JsonObject diagnostics) =>
        (viewer.DeepClone().AsObject(), listName, entries.DeepClone().AsArray(), diagnostics.DeepClone().AsObject());

    private static JsonArray ExtractCustomLists(JsonObject? source)
    {
        var result = new JsonArray();
        var animeList = source?["mediaListOptions"]?["animeList"] as JsonObject;
        foreach (var item in animeList?["customLists"] as JsonArray ?? [])
        {
            try
            {
                result.Add((JsonNode?)JsonValue.Create(ListMetadataStore.NormalizeCustomListName(item?.GetValue<string>())));
            }
            catch
            {
            }
        }
        return result;
    }

    private static JsonArray NormalizeCustomListMembership(JsonNode? source)
    {
        var result = new JsonArray();
        if (source is JsonArray array)
        {
            foreach (var item in array)
            {
                AddCustomListMembership(result, item?.GetValue<string>());
            }
            return result;
        }

        if (source is JsonObject map)
        {
            foreach (var item in map)
            {
                var included = item.Value is null
                    || item.Value.GetValueKind() == System.Text.Json.JsonValueKind.True
                    || string.Equals(item.Value.ToString(), "true", StringComparison.OrdinalIgnoreCase);
                if (included)
                {
                    AddCustomListMembership(result, item.Key);
                }
            }
        }
        return result;
    }

    private static void AddCustomListMembership(JsonArray result, string? value)
    {
        try
        {
            var name = ListMetadataStore.NormalizeCustomListName(value);
            if (!result.Any(item => string.Equals(item?.GetValue<string>(), name, StringComparison.OrdinalIgnoreCase)))
            {
                result.Add((JsonNode?)JsonValue.Create(name));
            }
        }
        catch
        {
        }
    }

    private static JsonArray ToJsonArray(IEnumerable<string> values)
    {
        var result = new JsonArray();
        foreach (var value in values)
        {
            result.Add((JsonNode?)JsonValue.Create(value));
        }
        return result;
    }

    private async Task<T> RunMutationAsync<T>(Func<Task<T>> action, CancellationToken cancellationToken)
    {
        await mutationLock.WaitAsync(cancellationToken);
        try
        {
            var delay = nextMutationAt - DateTimeOffset.UtcNow;
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay, cancellationToken);
            }

            return await action();
        }
        finally
        {
            nextMutationAt = DateTimeOffset.UtcNow.AddMilliseconds(900);
            mutationLock.Release();
        }
    }

    private static bool IsRateLimited(HttpResponseMessage response, string message) =>
        (int)response.StatusCode == 429 || message.Contains("Too Many Requests", StringComparison.OrdinalIgnoreCase);

    private static TimeSpan RateLimitDelay(HttpResponseMessage response, int attempt)
    {
        if (response.Headers.RetryAfter?.Delta is { } delta)
        {
            return delta < TimeSpan.FromSeconds(1) ? TimeSpan.FromSeconds(1) : delta;
        }
        if (response.Headers.RetryAfter?.Date is { } retryAt)
        {
            var until = retryAt - DateTimeOffset.UtcNow;
            if (until > TimeSpan.Zero)
            {
                return until;
            }
        }
        return TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, attempt + 1)));
    }

    private static string BuildBulkProgressMutation(IReadOnlyList<(int MediaId, int Progress)> updates)
    {
        var builder = new StringBuilder();
        builder.AppendLine("mutation BulkProgress {");
        for (var index = 0; index < updates.Count; index += 1)
        {
            var update = updates[index];
            builder.Append("  m").Append(index)
                .Append(": SaveMediaListEntry(mediaId: ").Append(update.MediaId)
                .Append(", progress: ").Append(update.Progress)
                .AppendLine(") {");
            builder.AppendLine("""
            id
            status
            progress
            score
            notes
            updatedAt
            startedAt { year month day }
            completedAt { year month day }
            repeat
            priority
            customLists
            media {
              id
              idMal
              episodes
              status
              endDate { year month day }
              seasonYear
              format
              isAdult
              siteUrl
              averageScore
              title { romaji english native }
              description(asHtml: true)
              genres
              synonyms
              coverImage { extraLarge large medium color }
              nextAiringEpisode {
                episode
                airingAt
                timeUntilAiring
              }
            }
              }
            """);
        }
        builder.AppendLine("}");
        return builder.ToString();
    }

    public static JsonObject NormalizeEntry(JsonObject entry)
    {
        var media = entry["media"] as JsonObject ?? new JsonObject();
        var titleObject = media["title"] as JsonObject ?? new JsonObject();
        var title = JsonUtil.String(titleObject, "english")
            ?? JsonUtil.String(titleObject, "romaji")
            ?? JsonUtil.String(titleObject, "native")
            ?? "Untitled";
        var cover = media["coverImage"] as JsonObject ?? new JsonObject();
        var nextAiring = media["nextAiringEpisode"] as JsonObject;
        var mediaStatus = JsonUtil.String(media, "status");
        var totalEpisodes = JsonUtil.Int(media, "episodes");

        var result = new JsonObject
        {
            ["id"] = JsonUtil.Int(entry, "id"),
            ["mediaId"] = JsonUtil.Int(media, "id"),
            ["status"] = JsonUtil.String(entry, "status"),
            ["progress"] = JsonUtil.Int(entry, "progress") ?? 0,
            ["score"] = JsonUtil.Double(entry, "score") ?? 0,
            ["notes"] = JsonUtil.String(entry, "notes") ?? "",
            ["updatedAt"] = JsonUtil.Int(entry, "updatedAt"),
            ["startedAt"] = entry["startedAt"]?.DeepClone(),
            ["completedAt"] = entry["completedAt"]?.DeepClone(),
            ["repeat"] = JsonUtil.Int(entry, "repeat") ?? 0,
            ["priority"] = JsonUtil.Int(entry, "priority") ?? 0,
            ["customLists"] = NormalizeCustomListMembership(entry["customLists"]),
            ["malId"] = JsonUtil.Int(media, "idMal"),
            ["title"] = title,
            ["romajiTitle"] = JsonUtil.String(titleObject, "romaji"),
            ["englishTitle"] = JsonUtil.String(titleObject, "english"),
            ["nativeTitle"] = JsonUtil.String(titleObject, "native"),
            ["descriptionHtml"] = JsonUtil.String(media, "description"),
            ["genres"] = (media["genres"] as JsonArray)?.DeepClone() ?? new JsonArray(),
            ["synonyms"] = (media["synonyms"] as JsonArray)?.DeepClone() ?? new JsonArray(),
            ["seasonYear"] = JsonUtil.Int(media, "seasonYear"),
            ["format"] = JsonUtil.String(media, "format"),
            ["isAdult"] = JsonUtil.Bool(media, "isAdult") == true,
            ["publicScore"] = JsonUtil.Int(media, "averageScore"),
            ["totalEpisodes"] = totalEpisodes,
            ["mediaStatus"] = mediaStatus,
            ["endDate"] = media["endDate"]?.DeepClone(),
            ["isAiring"] = mediaStatus == "RELEASING",
            ["coverImage"] = JsonUtil.String(cover, "large") ?? JsonUtil.String(cover, "medium"),
            ["coverImageLarge"] = JsonUtil.String(cover, "extraLarge") ?? JsonUtil.String(cover, "large") ?? JsonUtil.String(cover, "medium"),
            ["siteUrl"] = JsonUtil.String(media, "siteUrl")
        };

        result["nextAiringEpisode"] = nextAiring is null
            ? null
            : new JsonObject
            {
                ["episode"] = JsonUtil.Int(nextAiring, "episode"),
                ["airingAt"] = JsonUtil.Long(nextAiring, "airingAt"),
                ["timeUntilAiring"] = JsonUtil.Long(nextAiring, "timeUntilAiring")
            };
        return result;
    }

    private static JsonObject NormalizeSearchMedia(JsonObject media)
    {
        var mediaListEntry = media["mediaListEntry"] as JsonObject;
        var entry = new JsonObject
        {
            ["id"] = JsonUtil.Int(mediaListEntry, "id"),
            ["status"] = JsonUtil.String(mediaListEntry, "status"),
            ["progress"] = JsonUtil.Int(mediaListEntry, "progress") ?? 0,
            ["score"] = JsonUtil.Double(mediaListEntry, "score") ?? 0,
            ["media"] = media.DeepClone()
        };
        var normalized = NormalizeEntry(entry);
        normalized["listed"] = mediaListEntry is not null;
        normalized["listEntryId"] = JsonUtil.Int(mediaListEntry, "id");
        normalized["listStatus"] = JsonUtil.String(mediaListEntry, "status");
        return normalized;
    }
}
