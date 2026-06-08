using System.Net;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed class ApiServer(TokenStore tokens, ListMetadataStore listMetadata, WatchNowStore watchNow, AniListClient aniList, AvailabilityService availability, OfflineService offline, UpdateService updates, AppPaths paths)
{
    private const string SessionHeaderName = "X-AniList-Manager-Session";
    private static readonly HashSet<string> ListStatuses = ["CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING"];
    private readonly string sessionToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private HttpListener? listener;
    private CancellationTokenSource? cts;
    private Task? loopTask;

    public bool IsRunning => listener?.IsListening == true;

    public Task StartAsync()
    {
        if (IsRunning)
        {
            return Task.CompletedTask;
        }

        cts = new CancellationTokenSource();
        listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:6767/");
        listener.Prefixes.Add("http://localhost:6767/");
        listener.Start();
        loopTask = Task.Run(() => ListenLoopAsync(cts.Token));
        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        if (listener is null)
        {
            return;
        }

        try
        {
            cts?.Cancel();
            listener.Stop();
            listener.Close();
            if (loopTask is not null)
            {
                await loopTask.WaitAsync(TimeSpan.FromSeconds(2));
            }
        }
        catch
        {
        }
        finally
        {
            listener = null;
            cts?.Dispose();
            cts = null;
            loopTask = null;
        }
    }

    private async Task ListenLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && listener?.IsListening == true)
        {
            HttpListenerContext context;
            try
            {
                context = await listener.GetContextAsync().WaitAsync(cancellationToken);
            }
            catch
            {
                if (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
                continue;
            }

            _ = Task.Run(() => HandleAsync(context, cancellationToken), CancellationToken.None);
        }
    }

    private async Task HandleAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        try
        {
            if (context.Request.HttpMethod == "OPTIONS")
            {
                await SendTextAsync(context, 204, "");
                return;
            }

            var path = context.Request.Url?.AbsolutePath ?? "/";
            if (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase))
            {
                await HandleApiAsync(context, path, cancellationToken);
                return;
            }

            var asset = WebAssetServer.Resolve(path);
            context.Response.StatusCode = 200;
            context.Response.ContentType = asset.ContentType;
            context.Response.ContentLength64 = asset.Bytes.Length;
            await context.Response.OutputStream.WriteAsync(asset.Bytes, cancellationToken);
            context.Response.Close();
        }
        catch (ApiException error)
        {
            await SendJsonAsync(context, error.Status, JsonUtil.Error(error.Message, error.Details));
        }
        catch (Exception error)
        {
            await SendJsonAsync(context, 500, JsonUtil.Error(error.Message));
        }
    }

    private async Task HandleApiAsync(HttpListenerContext context, string path, CancellationToken cancellationToken)
    {
        var method = context.Request.HttpMethod.ToUpperInvariant();
        ValidateApiRequest(context, method, path);
        if (method == "GET" && path == "/api/session")
        {
            await SendJsonAsync(context, 200, new JsonObject
            {
                ["headerName"] = SessionHeaderName,
                ["sessionToken"] = sessionToken
            }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/health")
        {
            var health = tokens.HealthJson();
            health["offline"] = offline.Status();
            await SendJsonAsync(context, 200, health.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/offline")
        {
            await SendJsonAsync(context, 200, offline.Status().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/offline/queue")
        {
            await SendJsonAsync(context, 200, offline.QueueSummary().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/offline/enable")
        {
            if (offline.IsEnabled)
            {
                throw new ApiException("Offline Mode is already enabled.", 409);
            }
            await SendJsonAsync(context, 200, offline.BeginEnable().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path.StartsWith("/api/offline/enable/", StringComparison.OrdinalIgnoreCase))
        {
            var jobId = ParseTrailingText(path, "/api/offline/enable/");
            await SendJsonAsync(context, 200, offline.GetEnableJob(jobId).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/offline/sync")
        {
            await SendJsonAsync(context, 200, (await offline.SyncQueuedAsync(cancellationToken)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/offline/discard-failed")
        {
            await SendJsonAsync(context, 200, offline.DiscardQueued().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/offline/disable")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var syncQueued = JsonUtil.Bool(input, "syncQueued") == true;
            var discardQueued = JsonUtil.Bool(input, "discardQueued") == true;
            var removeData = JsonUtil.Bool(input, "removeData") == true;
            await SendJsonAsync(context, 200, (await offline.DisableAsync(syncQueued, discardQueued, removeData, cancellationToken)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path.StartsWith("/api/offline/images/", StringComparison.OrdinalIgnoreCase))
        {
            var fileName = ParseTrailingText(path, "/api/offline/images/");
            var image = offline.ReadImage(fileName);
            context.Response.StatusCode = 200;
            context.Response.ContentType = image.ContentType;
            context.Response.ContentLength64 = image.Bytes.Length;
            await context.Response.OutputStream.WriteAsync(image.Bytes, cancellationToken);
            context.Response.Close();
            return;
        }
        if (method == "GET" && path == "/api/readme")
        {
            var readmePath = System.IO.Path.Combine(paths.Root, "README.md");
            if (!System.IO.File.Exists(readmePath))
            {
                throw new ApiException("README.md not found.", 404);
            }
            var content = await System.IO.File.ReadAllTextAsync(readmePath, cancellationToken);
            var response = new JsonObject { ["content"] = content };
            await SendJsonAsync(context, 200, response.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/auth")
        {
            await SendJsonAsync(context, 200, (await GetAuthStateAsync(cancellationToken)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/settings")
        {
            await SendJsonAsync(context, 200, ReadPublicSettings().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/list-tabs")
        {
            var query = ParseQuery(context.Request.Url?.Query ?? "");
            var type = NormalizeType(query.TryGetValue("type", out var typeValue) ? typeValue : "ANIME");
            if (QueryFlag(query, "refresh"))
            {
                EnsureOnline("Custom list refresh is disabled while Offline Mode is active.");
                var customLists = await aniList.CustomListsAsync(cancellationToken);
                await SendJsonAsync(context, 200, listMetadata.ReplaceCustomListsFromRemote(customLists.Select(node => node?.GetValue<string>() ?? ""), type).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            await SendJsonAsync(context, 200, listMetadata.ReadTabs(type).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "PATCH" && path == "/api/list-tabs")
        {
            var query = ParseQuery(context.Request.Url?.Query ?? "");
            var type = NormalizeType(query.TryGetValue("type", out var typeValue) ? typeValue : "ANIME");
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            if (input.ContainsKey("visibleTabs") || input.ContainsKey("defaultTab"))
            {
                listMetadata.SaveSettings(input);
            }
            if (input.ContainsKey("customLists") || input.ContainsKey("counts"))
            {
                listMetadata.UpdateMetadata(input, type);
            }
            await SendJsonAsync(context, 200, listMetadata.ReadTabs(type).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/update")
        {
            await SendJsonAsync(context, 200, (await updates.GetAsync(false, cancellationToken)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/update/check")
        {
            await SendJsonAsync(context, 200, (await updates.GetAsync(true, cancellationToken)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/update/ignore")
        {
            await SendJsonAsync(context, 200, updates.IgnoreLatest().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "PATCH" && path == "/api/settings")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var watchNowInput = input["watchNow"] as JsonObject;
            var appearanceInput = input["appearance"] as JsonObject;
            var updatesInput = input["updates"] as JsonObject;
            var advancedFiltersInput = input["advancedFilters"] as JsonObject;
            var listsInput = input["lists"] as JsonObject;
            var quickListsModeByTabInput = input["quickListsModeByTab"] as JsonObject;
            if (input.ContainsKey("quickListsModeByTab") && quickListsModeByTabInput is null)
            {
                throw new ApiException("Quick Lists mode by tab must be an object.", 400);
            }
            var showNotes = input.ContainsKey("showNotes")
                ? JsonUtil.Bool(input, "showNotes") ?? throw new ApiException("Show Notes must be true or false.", 400)
                : (bool?)null;
            var simplifiedView = input.ContainsKey("simplifiedView")
                ? JsonUtil.Bool(input, "simplifiedView") ?? throw new ApiException("Simplified View must be true or false.", 400)
                : (bool?)null;
            var quickListsMode = input.ContainsKey("quickListsMode")
                ? (JsonUtil.String(input, "quickListsMode") ?? throw new ApiException("Quick Lists mode must be mini, full, or hidden.", 400))
                : null;
            if (watchNowInput is null && appearanceInput is null && updatesInput is null && advancedFiltersInput is null && listsInput is null && showNotes is null && simplifiedView is null && quickListsMode is null && quickListsModeByTabInput is null)
            {
                throw new ApiException("Provide Appearance, Watch Now, Updates, Advanced Filters, Lists settings, Show Notes, Quick Lists mode, or Simplified View.", 400);
            }
            if (appearanceInput is not null || updatesInput is not null || advancedFiltersInput is not null || showNotes.HasValue || simplifiedView.HasValue || quickListsMode is not null || quickListsModeByTabInput is not null)
            {
                tokens.SavePublicSettings(appearanceInput, updatesInput, showNotes, advancedFiltersInput, simplifiedView, quickListsMode, quickListsModeByTabInput);
            }
            if (listsInput is not null)
            {
                listMetadata.SaveSettings(listsInput);
            }
            if (watchNowInput is not null)
            {
                watchNow.SaveSettings(watchNowInput);
            }
            await SendJsonAsync(context, 200, ReadPublicSettings().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/custom-lists")
        {
            EnsureOnline("Custom list changes are disabled while Offline Mode is active.");
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var type = NormalizeType(JsonUtil.String(input, "type") ?? "ANIME");
            var name = ListMetadataStore.NormalizeCustomListName(JsonUtil.String(input, "name"));
            var customLists = await aniList.CreateCustomListAsync(name, type, cancellationToken);
            await SendJsonAsync(context, 200, listMetadata.MergeCustomLists(customLists.Select(node => node?.GetValue<string>() ?? ""), type).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "DELETE" && path.StartsWith("/api/custom-lists/", StringComparison.OrdinalIgnoreCase))
        {
            EnsureOnline("Custom list changes are disabled while Offline Mode is active.");
            var query = ParseQuery(context.Request.Url?.Query ?? "");
            var type = NormalizeType(query.TryGetValue("type", out var typeValue) ? typeValue : "ANIME");
            var name = ListMetadataStore.NormalizeCustomListName(ParseTrailingText(path, "/api/custom-lists/"));
            var customLists = await aniList.DeleteCustomListAsync(name, type, cancellationToken);
            await SendJsonAsync(context, 200, listMetadata.ReplaceCustomListsFromRemote(customLists.Select(node => node?.GetValue<string>() ?? ""), type).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/watch-now/servers")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            watchNow.AddServer(input);
            await SendJsonAsync(context, 200, ReadPublicSettings().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "DELETE" && path.StartsWith("/api/watch-now/servers/", StringComparison.OrdinalIgnoreCase))
        {
            var serverId = ParseTrailingText(path, "/api/watch-now/servers/");
            watchNow.DeleteServer(serverId);
            await SendJsonAsync(context, 200, ReadPublicSettings().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/auth/token")
        {
            EnsureOnline("Token changes are disabled while Offline Mode is active.");
            var body = await ReadBodyAsync(context);
            var token = JsonUtil.String(JsonNode.Parse(body), "token");
            if (string.IsNullOrWhiteSpace(token) || token.Trim().Length < 20)
            {
                throw new ApiException("Token is too short.", 400);
            }
            await aniList.ViewerAsync(token.Trim(), cancellationToken);
            tokens.SavePortableToken(token.Trim());
            aniList.ClearListCache();
            var state = await GetAuthStateAsync(cancellationToken);
            state["saved"] = true;
            state["message"] = JsonUtil.String(state, "tokenSource") == "env"
                ? "Saved the token to portable config, but the app is currently using an environment-provided token."
                : "Token saved.";
            await SendJsonAsync(context, 200, state.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/auth/import-cli")
        {
            EnsureOnline("Token import is disabled while Offline Mode is active.");
            var cliToken = tokens.ReadCliToken();
            if (string.IsNullOrWhiteSpace(cliToken))
            {
                throw new ApiException("No anilist-cli token was found to import.", 404);
            }
            await aniList.ViewerAsync(cliToken, cancellationToken);
            tokens.SavePortableToken(cliToken);
            aniList.ClearListCache();
            var state = await GetAuthStateAsync(cancellationToken);
            state["imported"] = true;
            state["message"] = JsonUtil.String(state, "tokenSource") == "env"
                ? "Imported the anilist-cli token into portable config, but the app is currently using an environment-provided token."
                : "Imported token from anilist-cli.";
            await SendJsonAsync(context, 200, state.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "DELETE" && path == "/api/auth/token")
        {
            var state = tokens.Resolve();
            if (state.Source == "env")
            {
                throw new ApiException("The active AniList token comes from ANILIST_TOKEN or ANILIST_ACCESS_TOKEN, so it cannot be removed from this app.", 409);
            }
            tokens.ClearPortableToken();
            aniList.ClearListCache();
            var auth = await GetAuthStateAsync(cancellationToken);
            auth["removed"] = true;
            auth["message"] = "Logged out. The portable token was removed.";
            await SendJsonAsync(context, 200, auth.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/me")
        {
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, (offline.Status()["user"]?.DeepClone() ?? new JsonObject()).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            await SendJsonAsync(context, 200, (await aniList.ViewerAsync(cancellationToken: cancellationToken)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/search/anime")
        {
            EnsureOnline("AniList search is disabled while Offline Mode is active.");
            var query = ParseQuery(context.Request.Url?.Query ?? "");
            var search = query.TryGetValue("query", out var queryValue) ? queryValue.Trim() : "";
            if (string.IsNullOrWhiteSpace(search))
            {
                throw new ApiException("Enter a search query.", 400);
            }
            var page = query.TryGetValue("page", out var pageValue) && int.TryParse(pageValue, out var parsedPage) ? parsedPage : 1;
            var perPage = query.TryGetValue("perPage", out var perPageValue) && int.TryParse(perPageValue, out var parsedPerPage) ? parsedPerPage : 20;
            var result = await aniList.SearchAnimeAsync(search, page, perPage, cancellationToken);
            await SendJsonAsync(context, 200, new JsonObject
            {
                ["query"] = search,
                ["type"] = "ANIME",
                ["pageInfo"] = result["pageInfo"]?.DeepClone() ?? new JsonObject(),
                ["entries"] = result["entries"]?.DeepClone() ?? new JsonArray()
            }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/lists")
        {
            var requestTimer = Stopwatch.StartNew();
            var query = ParseQuery(context.Request.Url?.Query ?? "");
            var status = NormalizeStatus(query.TryGetValue("status", out var statusValue) ? statusValue : "CURRENT");
            var type = (query.TryGetValue("type", out var typeValue) ? typeValue : "ANIME").ToUpperInvariant();
            if (type != "ANIME")
            {
                throw new ApiException("Only ANIME lists are supported.", 400);
            }
            if (offline.IsEnabled)
            {
                var offlineList = offline.GetList(status, type);
                listMetadata.UpdateFromStatus(status, type, offlineList["entries"] as JsonArray ?? new JsonArray());
                offlineList["diagnostics"] = new JsonObject
                {
                    ["source"] = "local-offline",
                    ["localApiMs"] = requestTimer.ElapsedMilliseconds,
                    ["entryCount"] = JsonUtil.Array(offlineList, "entries").Count,
                    ["selectedStatus"] = status
                };
                await SendJsonAsync(context, 200, offlineList.ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var chunk = query.TryGetValue("chunk", out var chunkValue) && int.TryParse(chunkValue, out var parsedChunk)
                ? Math.Max(1, parsedChunk)
                : (int?)null;
            var perChunk = query.TryGetValue("perChunk", out var perChunkValue) && int.TryParse(perChunkValue, out var parsedPerChunk)
                ? Math.Clamp(parsedPerChunk, 1, 500)
                : (int?)null;
            var result = await aniList.GetListEntriesAsync(status, type, chunk, perChunk, cancellationToken);
            if (!chunk.HasValue && !perChunk.HasValue)
            {
                listMetadata.UpdateFromStatus(status, type, result.Entries);
            }
            result.Diagnostics["localApiMs"] = requestTimer.ElapsedMilliseconds;
            await SendJsonAsync(context, 200, new JsonObject
            {
                ["user"] = result.Viewer.DeepClone(),
                ["type"] = type,
                ["status"] = status,
                ["listName"] = result.ListName,
                ["entries"] = result.Entries.DeepClone(),
                ["diagnostics"] = result.Diagnostics.DeepClone()
            }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "GET" && path == "/api/availability")
        {
            var query = ParseQuery(context.Request.Url?.Query ?? "");
            var status = NormalizeStatus(query.TryGetValue("status", out var statusValue) ? statusValue : "CURRENT");
            var type = (query.TryGetValue("type", out var typeValue) ? typeValue : "ANIME").ToUpperInvariant();
            var refresh = query.TryGetValue("refresh", out var refreshValue) && refreshValue.Equals("true", StringComparison.OrdinalIgnoreCase);
            if (offline.IsEnabled)
            {
                var offlineList = offline.GetList(status, type);
                await SendJsonAsync(context, 200, offline.GetAvailability(offlineList["entries"] as JsonArray ?? new JsonArray()).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var list = await aniList.GetListEntriesAsync(status, type, cancellationToken: cancellationToken);
            var cacheOnly = query.TryGetValue("cacheOnly", out var cacheOnlyValue) && cacheOnlyValue.Equals("true", StringComparison.OrdinalIgnoreCase);
            await SendAvailabilityAsync(context, list.Entries, refresh, false, cacheOnly, false, status, type, cancellationToken);
            return;
        }
        if (method == "GET" && path == "/api/availability/overrides")
        {
            await SendJsonAsync(context, 200, availability.ReadOverrides().ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/availability/batch")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var entries = input["entries"] as JsonArray ?? throw new ApiException("Provide entries.", 400);
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, offline.GetAvailability(entries).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var refresh = JsonUtil.Bool(input, "refresh") == true;
            var force = JsonUtil.Bool(input, "force") == true;
            var cacheOnly = JsonUtil.Bool(input, "cacheOnly") == true;
            var usableCacheOnly = JsonUtil.Bool(input, "usableCacheOnly") == true;
            await SendAvailabilityAsync(context, entries, refresh, force, cacheOnly, usableCacheOnly, null, null, cancellationToken);
            return;
        }
        if (method == "POST" && path == "/api/ratings/batch")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var entries = input["entries"] as JsonArray ?? throw new ApiException("Provide entries.", 400);
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, offline.GetRatings(entries).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var cacheOnly = JsonUtil.Bool(input, "cacheOnly") == true;
            await SendJsonAsync(context, 200, (await availability.ResolveRatingsAsync(entries, cancellationToken, cacheOnly)).ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "PUT" && path.StartsWith("/api/availability/overrides/", StringComparison.OrdinalIgnoreCase))
        {
            var mediaId = ParseTrailingInt(path, "/api/availability/overrides/");
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var result = availability.SaveOverride(mediaId, input);
            await SendJsonAsync(context, 200, new JsonObject { ["availability"] = result }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "DELETE" && path.StartsWith("/api/availability/overrides/", StringComparison.OrdinalIgnoreCase))
        {
            var mediaId = ParseTrailingInt(path, "/api/availability/overrides/");
            availability.DeleteOverride(mediaId);
            await SendJsonAsync(context, 200, new JsonObject { ["deleted"] = true, ["mediaId"] = mediaId }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "PATCH" && path.StartsWith("/api/entries/", StringComparison.OrdinalIgnoreCase))
        {
            var mediaId = ParseTrailingInt(path, "/api/entries/");
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var progress = JsonUtil.Int(input, "progress");
            var status = JsonUtil.String(input, "status");
            var score = ReadOptionalDouble(input, "score");
            var notesProvided = input.ContainsKey("notes");
            var notes = JsonUtil.String(input, "notes");
            var progressProvided = input.ContainsKey("progress");
            var scoreProvided = input.ContainsKey("score");
            var customListsProvided = input.ContainsKey("customLists");
            string[]? customLists = null;
            if (customListsProvided)
            {
                if (input["customLists"] is not JsonArray customListsInput)
                {
                    throw new ApiException("Custom Lists must be an array.", 400);
                }
                customLists = customListsInput
                    .Select(item => ListMetadataStore.NormalizeCustomListName(item?.GetValue<string>()))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToArray();
            }
            if (!progressProvided && string.IsNullOrWhiteSpace(status) && !scoreProvided && !notesProvided && !customListsProvided)
            {
                throw new ApiException("Provide progress, status, score, notes, customLists, or a combination.", 400);
            }
            if (status is not null)
            {
                status = NormalizeStatus(status);
            }
            if (offline.IsEnabled && customListsProvided)
            {
                throw new ApiException("Custom list membership changes are disabled while Offline Mode is active.", 409);
            }
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, offline.QueueSaveEntry(mediaId, progress, progressProvided, status, score, scoreProvided, notes, notesProvided).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var entry = await aniList.SaveEntryAsync(mediaId, progress, status, score, notes, notesProvided, customLists, customListsProvided, cancellationToken);
            if (customListsProvided && customLists is not null)
            {
                listMetadata.MergeCustomLists(customLists, "ANIME");
            }
            await SendJsonAsync(context, 200, new JsonObject { ["entry"] = entry }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "DELETE" && path.StartsWith("/api/list-entries/", StringComparison.OrdinalIgnoreCase))
        {
            var entryId = ParseTrailingInt(path, "/api/list-entries/");
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, offline.QueueDeleteEntry(entryId).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            await aniList.DeleteEntryAsync(entryId, cancellationToken);
            await SendJsonAsync(context, 200, new JsonObject { ["deleted"] = true, ["entryId"] = entryId }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/bulk/status")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var status = NormalizeStatus(JsonUtil.String(input, "status") ?? "");
            var ids = input["mediaIds"] as JsonArray ?? throw new ApiException("Provide mediaIds.", 400);
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, offline.QueueBulkStatus(ids, status).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var entries = new JsonArray();
            foreach (var id in ids.Select(id => id?.GetValue<int>() ?? 0).Where(id => id > 0))
            {
                entries.Add((JsonNode?)await aniList.SaveEntryAsync(id, null, status, cancellationToken: cancellationToken));
            }
            await SendJsonAsync(context, 200, new JsonObject { ["updated"] = entries.Count, ["entries"] = entries }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/bulk/progress")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var updates = input["updates"] as JsonArray ?? throw new ApiException("Provide updates.", 400);
            if (offline.IsEnabled)
            {
                await SendJsonAsync(context, 200, offline.QueueBulkProgress(updates).ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var requestedUpdates = updates
                .OfType<JsonObject>()
                .Select(update => (MediaId: JsonUtil.Int(update, "mediaId") ?? 0, Progress: JsonUtil.Int(update, "progress") ?? 0))
                .Where(update => update.MediaId > 0)
                .ToArray();
            var entries = await aniList.SaveProgressEntriesAsync(requestedUpdates, cancellationToken);
            await SendJsonAsync(context, 200, new JsonObject { ["updated"] = entries.Count, ["entries"] = entries }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/bulk/custom-lists")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var updates = input["updates"] as JsonArray ?? throw new ApiException("Provide updates.", 400);
            if (offline.IsEnabled)
            {
                throw new ApiException("Custom list membership changes are disabled while Offline Mode is active.", 409);
            }
            var requestedUpdates = updates
                .OfType<JsonObject>()
                .Select(update =>
                {
                    var mediaId = JsonUtil.Int(update, "mediaId") ?? 0;
                    var customListsInput = update["customLists"] as JsonArray ?? throw new ApiException("Custom Lists must be an array.", 400);
                    var customLists = customListsInput
                        .Select(item => ListMetadataStore.NormalizeCustomListName(item?.GetValue<string>()))
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToArray();
                    return (MediaId: mediaId, CustomLists: customLists);
                })
                .Where(update => update.MediaId > 0)
                .ToArray();
            var entries = new JsonArray();
            foreach (var update in requestedUpdates)
            {
                entries.Add((JsonNode?)await aniList.SaveEntryAsync(update.MediaId, null, null, customLists: update.CustomLists, customListsProvided: true, cancellationToken: cancellationToken));
                listMetadata.MergeCustomLists(update.CustomLists, "ANIME");
            }
            await SendJsonAsync(context, 200, new JsonObject { ["updated"] = entries.Count, ["entries"] = entries }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }
        if (method == "POST" && path == "/api/bulk/delete")
        {
            var input = JsonNode.Parse(await ReadBodyAsync(context)) as JsonObject ?? new JsonObject();
            var ids = input["entryIds"] as JsonArray ?? throw new ApiException("Provide entryIds.", 400);
            if (offline.IsEnabled)
            {
                var offlineDeleted = new JsonArray();
                foreach (var id in ids.Select(id => id?.GetValue<int>() ?? 0).Where(id => id > 0))
                {
                    offline.QueueDeleteEntry(id);
                    offlineDeleted.Add((JsonNode?)id);
                }
                await SendJsonAsync(context, 200, new JsonObject { ["deleted"] = offlineDeleted.Count, ["entryIds"] = offlineDeleted, ["offline"] = true, ["queued"] = offline.Status()["queued"]?.DeepClone() }.ToJsonString(JsonUtil.WriterOptions));
                return;
            }
            var deleted = new JsonArray();
            foreach (var id in ids.Select(id => id?.GetValue<int>() ?? 0).Where(id => id > 0))
            {
                await aniList.DeleteEntryAsync(id, cancellationToken);
                deleted.Add((JsonNode?)id);
            }
            await SendJsonAsync(context, 200, new JsonObject { ["deleted"] = deleted.Count, ["entryIds"] = deleted }.ToJsonString(JsonUtil.WriterOptions));
            return;
        }

        throw new ApiException("Not found.", 404);
    }

    private void ValidateApiRequest(HttpListenerContext context, string method, string path)
    {
        var origin = context.Request.Headers["Origin"];
        if (!string.IsNullOrWhiteSpace(origin) && !IsAllowedLocalOrigin(origin))
        {
            throw new ApiException("Cross-origin API requests are not allowed.", 403);
        }

        var fetchSite = context.Request.Headers["Sec-Fetch-Site"];
        if (string.Equals(fetchSite, "cross-site", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException("Cross-site API requests are not allowed.", 403);
        }

        if (path == "/api/session" || !RequiresSessionHeader(method))
        {
            return;
        }

        var providedToken = context.Request.Headers[SessionHeaderName];
        if (!CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(providedToken ?? ""),
            Encoding.UTF8.GetBytes(sessionToken)))
        {
            throw new ApiException("Invalid or missing local session header.", 403);
        }
    }

    private static bool RequiresSessionHeader(string method) =>
        method is "POST" or "PUT" or "PATCH" or "DELETE";

    private static bool IsAllowedLocalOrigin(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
        {
            return false;
        }

        return uri.Scheme == Uri.UriSchemeHttp
            && uri.Port == 6767
            && (string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || string.Equals(uri.Host, "127.0.0.1", StringComparison.OrdinalIgnoreCase));
    }

    private async Task<JsonObject> GetAuthStateAsync(CancellationToken cancellationToken)
    {
        var tokenState = tokens.Resolve();
        if (offline.IsEnabled)
        {
            return offline.OfflineAuthState(tokenState);
        }
        var state = new JsonObject
        {
            ["tokenPresent"] = tokenState.Token is not null,
            ["tokenSource"] = tokenState.Source,
            ["tokenSourceLabel"] = tokenState.SourceLabel,
            ["configPath"] = tokenState.ConfigPath,
            ["portableTokenPresent"] = tokenState.PortableTokenPresent,
            ["cliImportAvailable"] = tokenState.CliImportAvailable,
            ["valid"] = false,
            ["user"] = null
        };
        if (tokenState.Token is null)
        {
            return state;
        }

        try
        {
            state["user"] = await aniList.ViewerAsync(tokenState.Token, cancellationToken);
            state["valid"] = true;
        }
        catch (Exception error)
        {
            state["authError"] = error.Message;
        }
        return state;
    }

    private JsonObject ReadPublicSettings()
    {
        var settings = tokens.ReadPublicSettings();
        settings["lists"] = listMetadata.ReadPublicSettings();
        settings["watchNow"] = watchNow.ReadPublicSettings();
        settings["offline"] = offline.Status();
        return settings;
    }

    private void EnsureOnline(string message)
    {
        if (offline.IsEnabled)
        {
            throw new ApiException(message, 409);
        }
    }

    private async Task SendAvailabilityAsync(HttpListenerContext context, JsonArray entries, bool refresh, bool force, bool cacheOnly, bool usableCacheOnly, string? status, string? type, CancellationToken cancellationToken)
    {
        if (entries.Count > 25 && status is null)
        {
            throw new ApiException("Availability batches are limited to 25 entries.", 400);
        }

        var cache = availability.ReadCache();
        var warnings = new JsonArray();
        var results = new JsonArray();
        var warningLock = new object();
        var cachedCount = 0;
        var checkedCount = 0;
        var semaphore = new SemaphoreSlim(6);
        var tasks = entries.OfType<JsonObject>().Select(async entry =>
        {
            await semaphore.WaitAsync(cancellationToken);
            try
            {
                if (usableCacheOnly)
                {
                    var reusableCachedOnly = availability.GetReusableCachedResult(entry, false, cache);
                    if (reusableCachedOnly is not null)
                    {
                        Interlocked.Increment(ref cachedCount);
                    }
                    return reusableCachedOnly;
                }

                if (cacheOnly)
                {
                    var cachedOnly = availability.GetCachedResult(entry, cache);
                    if (cachedOnly is not null)
                    {
                        Interlocked.Increment(ref cachedCount);
                    }
                    return cachedOnly;
                }

                if (!force)
                {
                    var cached = availability.GetReusableCachedResult(entry, refresh, cache);
                    if (cached is not null)
                    {
                        Interlocked.Increment(ref cachedCount);
                        return cached;
                    }
                }

                if (availability.SuppressesAutomaticAvailability(entry))
                {
                    return null;
                }

                Interlocked.Increment(ref checkedCount);
                return await availability.ResolveAsync(entry, refresh, cache, cancellationToken, force);
            }
            catch (Exception error)
            {
                lock (warningLock)
                {
                    warnings.Add((JsonNode?)new JsonObject
                    {
                        ["mediaId"] = JsonUtil.Int(entry, "mediaId"),
                        ["title"] = JsonUtil.String(entry, "title"),
                        ["error"] = error.Message
                    });
                }
                return availability.ErrorResult(entry, error);
            }
            finally
            {
                semaphore.Release();
            }
        }).ToArray();

        foreach (var result in await Task.WhenAll(tasks))
        {
            if (result is not null)
            {
                results.Add((JsonNode?)result);
            }
        }
        availability.WriteCache(cache);
        var warningCount = warnings.Count;
        var rateLimited = warnings.OfType<JsonObject>().Any(warning =>
            (JsonUtil.String(warning, "error") ?? "").Contains("429", StringComparison.OrdinalIgnoreCase) ||
            (JsonUtil.String(warning, "error") ?? "").Contains("rate limit", StringComparison.OrdinalIgnoreCase) ||
            (JsonUtil.String(warning, "error") ?? "").Contains("rate_limited", StringComparison.OrdinalIgnoreCase));

        var response = new JsonObject
        {
            ["source"] = "anime-api",
            ["providerUrl"] = "https://allanime-api.shashankbhake.codes",
            ["entries"] = results,
            ["warnings"] = warnings,
            ["warningCount"] = warningCount,
            ["rateLimited"] = rateLimited,
            ["cached"] = cachedCount,
            ["checked"] = checkedCount,
            ["force"] = force,
            ["cacheOnly"] = cacheOnly,
            ["usableCacheOnly"] = usableCacheOnly
        };
        if (status is not null)
        {
            response["type"] = type;
            response["status"] = status;
        }
        await SendJsonAsync(context, 200, response.ToJsonString(JsonUtil.WriterOptions));
    }

    private static string NormalizeStatus(string value)
    {
        var status = value.ToUpperInvariant();
        if (!ListStatuses.Contains(status))
        {
            throw new ApiException("Invalid list status.", 400);
        }
        return status;
    }

    private static string NormalizeType(string value)
    {
        var type = value.ToUpperInvariant();
        if (type != "ANIME")
        {
            throw new ApiException("Only ANIME lists are supported.", 400);
        }
        return type;
    }

    private static int ParseTrailingInt(string path, string prefix)
    {
        var raw = path[prefix.Length..].Trim('/');
        return int.TryParse(raw, out var value) && value > 0 ? value : throw new ApiException("Invalid id.", 400);
    }

    private static string ParseTrailingText(string path, string prefix)
    {
        var raw = Uri.UnescapeDataString(path[prefix.Length..].Trim('/'));
        return !string.IsNullOrWhiteSpace(raw) && !raw.Contains('/')
            ? raw
            : throw new ApiException("Invalid id.", 400);
    }

    private static double? ReadOptionalDouble(JsonObject input, string name)
    {
        var value = input[name];
        if (value is null)
        {
            return null;
        }
        try
        {
            return value.GetValue<double>();
        }
        catch
        {
            return double.TryParse(value.ToString(), out var parsed) ? parsed : null;
        }
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pieces = part.Split('=', 2);
            result[Uri.UnescapeDataString(pieces[0])] = pieces.Length > 1 ? Uri.UnescapeDataString(pieces[1]) : "";
        }
        return result;
    }

    private static bool QueryFlag(Dictionary<string, string> query, string name) =>
        query.TryGetValue(name, out var value)
        && (string.IsNullOrWhiteSpace(value)
            || string.Equals(value, "1", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "true", StringComparison.OrdinalIgnoreCase)
            || string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase));

    private static async Task<string> ReadBodyAsync(HttpListenerContext context)
    {
        using var reader = new StreamReader(context.Request.InputStream, context.Request.ContentEncoding ?? Encoding.UTF8);
        return await reader.ReadToEndAsync();
    }

    private static async Task SendJsonAsync(HttpListenerContext context, int status, string json)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json; charset=utf-8";
        var bytes = Encoding.UTF8.GetBytes(json);
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes);
        context.Response.Close();
    }

    private static async Task SendTextAsync(HttpListenerContext context, int status, string text)
    {
        context.Response.StatusCode = status;
        var bytes = Encoding.UTF8.GetBytes(text);
        context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes);
        context.Response.Close();
    }
}
