using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed record WatchNowServerSeed(
    string Id,
    string Name,
    string DetailsUrlTemplate,
    string WatchUrlTemplate);

internal sealed class WatchNowStore(AppPaths paths)
{
    private static readonly WatchNowServerSeed[] BuiltInServers =
    [
        new("1anime", "1Anime", "https://1anime.app/anime/<anilistid>", "https://1anime.app/watch/<anilistid>?e=<episode>"),
        new("animegers", "Animegers", "https://animegers.com/details/<anilistid>", "https://animegers.com/watch/<anilistid>?ep=<episode>"),
        new("miruro", "Miruro", "https://www.miruro.tv/info/<anilistid>", "https://www.miruro.tv/watch/<anilistid>?ep=<episode>"),
        new("heanime", "HeAnime", "https://heanime.com/details/<anilistid>", "https://heanime.com/watch/<anilistid>?ep=<episode>"),
        new("animeobt", "AnimeOBT", "https://animeobt.com/anime/<anilistid>", "https://animeobt.com/watch/<anilistid>/ep-<episode>")
    ];

    private readonly object storeLock = new();

    public JsonObject ReadPublicSettings()
    {
        lock (storeLock)
        {
            return PublicSettings(ReadOrCreateUnlocked());
        }
    }

    public JsonObject SaveSettings(JsonObject input)
    {
        if (!input.ContainsKey("selectedServerId")
            && !input.ContainsKey("hideWatchNow")
            && !input.ContainsKey("useAniListDetails")
            && !input.ContainsKey("showUnwatchedDubAlert")
            && !input.ContainsKey("showUnwatchedSubAlert"))
        {
            throw new ApiException("Provide selectedServerId, hideWatchNow, useAniListDetails, showUnwatchedDubAlert, or showUnwatchedSubAlert.", 400);
        }

        lock (storeLock)
        {
            var settings = ReadOrCreateUnlocked();
            if (input.ContainsKey("selectedServerId"))
            {
                var selectedServerId = ReadOptionalInputString(input, "selectedServerId", "Selected server id must be text.")?.Trim();
                if (string.IsNullOrWhiteSpace(selectedServerId))
                {
                    settings["selectedServerId"] = null;
                }
                else if (!HasServer(settings, selectedServerId))
                {
                    throw new ApiException("Selected Watch Now server was not found.", 400);
                }
                else
                {
                    settings["selectedServerId"] = selectedServerId;
                }
            }

            if (input.ContainsKey("hideWatchNow"))
            {
                settings["hideWatchNow"] = ReadInputBool(input, "hideWatchNow", "Hide Watch Now must be true or false.");
            }

            if (input.ContainsKey("useAniListDetails"))
            {
                settings["useAniListDetails"] = ReadInputBool(input, "useAniListDetails", "Use AniList Details must be true or false.");
            }

            if (input.ContainsKey("showUnwatchedDubAlert"))
            {
                settings["showUnwatchedDubAlert"] = ReadInputBool(input, "showUnwatchedDubAlert", "Show Unwatched Dub Alert must be true or false.");
            }

            if (input.ContainsKey("showUnwatchedSubAlert"))
            {
                settings["showUnwatchedSubAlert"] = ReadInputBool(input, "showUnwatchedSubAlert", "Show Unwatched Sub Alert must be true or false.");
            }

            WriteUnlocked(settings);
            return PublicSettings(settings);
        }
    }

    public JsonObject AddServer(JsonObject input)
    {
        var name = ReadRequiredInputString(input, "name", "Watch Now server name is required.").Trim();
        var detailsUrlTemplate = ReadRequiredInputString(input, "detailsUrlTemplate", "Details URL template is required.").Trim();
        var watchUrlTemplate = ReadRequiredInputString(input, "watchUrlTemplate", "Watch URL template is required.").Trim();
        ValidateDetailsTemplate(detailsUrlTemplate);
        ValidateWatchTemplate(watchUrlTemplate);

        lock (storeLock)
        {
            var settings = ReadOrCreateUnlocked();
            JsonUtil.Array(settings, "servers").Add((JsonNode?)CreateServer(
                $"custom-{Guid.NewGuid():N}",
                name,
                detailsUrlTemplate,
                watchUrlTemplate));
            WriteUnlocked(settings);
            return PublicSettings(settings);
        }
    }

    public JsonObject DeleteServer(string serverId)
    {
        if (string.IsNullOrWhiteSpace(serverId))
        {
            throw new ApiException("Watch Now server id is required.", 400);
        }

        lock (storeLock)
        {
            var settings = ReadOrCreateUnlocked();
            var servers = JsonUtil.Array(settings, "servers");
            var deleted = false;
            for (var index = servers.Count - 1; index >= 0; index -= 1)
            {
                if (servers[index] is JsonObject server
                    && string.Equals(ReadSavedString(server, "id"), serverId, StringComparison.Ordinal))
                {
                    servers.RemoveAt(index);
                    deleted = true;
                }
            }

            if (!deleted)
            {
                throw new ApiException("Watch Now server was not found.", 404);
            }

            if (string.Equals(ReadSavedString(settings, "selectedServerId"), serverId, StringComparison.Ordinal))
            {
                settings["selectedServerId"] = null;
            }

            WriteUnlocked(settings);
            return PublicSettings(settings);
        }
    }

    private JsonObject ReadOrCreateUnlocked()
    {
        if (!File.Exists(paths.WatchNowServersPath))
        {
            var settings = InitialSettings();
            WriteUnlocked(settings);
            return settings;
        }

        return Normalize(JsonUtil.ReadObject(paths.WatchNowServersPath));
    }

    private JsonObject InitialSettings()
    {
        var servers = new JsonArray();
        foreach (var server in BuiltInServers)
        {
            servers.Add((JsonNode?)CreateServer(server.Id, server.Name, server.DetailsUrlTemplate, server.WatchUrlTemplate));
        }

        var selectedServerId = BuiltInServers[0].Id;
        var legacyTemplate = ReadSavedString(paths.ReadPortableConfig(), "watchNowTemplate")?.Trim();
        if (IsValidDetailsTemplate(legacyTemplate))
        {
            var builtIn = BuiltInServers.FirstOrDefault(server =>
                string.Equals(server.DetailsUrlTemplate, legacyTemplate, StringComparison.OrdinalIgnoreCase));
            if (builtIn is not null)
            {
                selectedServerId = builtIn.Id;
            }
            else
            {
                selectedServerId = $"custom-{Guid.NewGuid():N}";
                servers.Add((JsonNode?)CreateServer(
                    selectedServerId,
                    "Migrated custom server",
                    legacyTemplate!,
                    LegacyWatchTemplate(legacyTemplate!)));
            }
        }

        return new JsonObject
        {
            ["selectedServerId"] = selectedServerId,
            ["hideWatchNow"] = false,
            ["useAniListDetails"] = false,
            ["showUnwatchedDubAlert"] = false,
            ["showUnwatchedSubAlert"] = false,
            ["servers"] = servers
        };
    }

    private static JsonObject Normalize(JsonObject saved)
    {
        var servers = new JsonArray();
        var knownIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var value in JsonUtil.Array(saved, "servers"))
        {
            if (value is not JsonObject server)
            {
                continue;
            }

            var id = ReadSavedString(server, "id")?.Trim();
            var name = ReadSavedString(server, "name")?.Trim();
            var detailsUrlTemplate = ReadSavedString(server, "detailsUrlTemplate")?.Trim();
            var watchUrlTemplate = ReadSavedString(server, "watchUrlTemplate")?.Trim();
            if (string.IsNullOrWhiteSpace(id)
                || string.IsNullOrWhiteSpace(name)
                || !knownIds.Add(id)
                || !IsValidDetailsTemplate(detailsUrlTemplate)
                || !IsValidWatchTemplate(watchUrlTemplate))
            {
                continue;
            }

            servers.Add((JsonNode?)CreateServer(id, name, detailsUrlTemplate!, watchUrlTemplate!));
        }

        var selectedServerId = ReadSavedString(saved, "selectedServerId")?.Trim();
        if (string.IsNullOrWhiteSpace(selectedServerId) || !knownIds.Contains(selectedServerId))
        {
            selectedServerId = null;
        }

        return new JsonObject
        {
            ["selectedServerId"] = selectedServerId,
            ["hideWatchNow"] = ReadSavedBool(saved, "hideWatchNow"),
            ["useAniListDetails"] = ReadSavedBool(saved, "useAniListDetails"),
            ["showUnwatchedDubAlert"] = ReadSavedBool(saved, "showUnwatchedDubAlert"),
            ["showUnwatchedSubAlert"] = ReadSavedBool(saved, "showUnwatchedSubAlert"),
            ["servers"] = servers
        };
    }

    private static JsonObject PublicSettings(JsonObject settings) => new()
    {
        ["selectedServerId"] = ReadSavedString(settings, "selectedServerId"),
        ["hideWatchNow"] = ReadSavedBool(settings, "hideWatchNow"),
        ["useAniListDetails"] = ReadSavedBool(settings, "useAniListDetails"),
        ["showUnwatchedDubAlert"] = ReadSavedBool(settings, "showUnwatchedDubAlert"),
        ["showUnwatchedSubAlert"] = ReadSavedBool(settings, "showUnwatchedSubAlert"),
        ["servers"] = JsonUtil.Array(settings, "servers").DeepClone()
    };

    private static bool HasServer(JsonObject settings, string serverId) =>
        JsonUtil.Array(settings, "servers")
            .OfType<JsonObject>()
            .Any(server => string.Equals(ReadSavedString(server, "id"), serverId, StringComparison.Ordinal));

    private void WriteUnlocked(JsonObject settings)
    {
        Directory.CreateDirectory(paths.DataDir);
        File.WriteAllText(paths.WatchNowServersPath, settings.ToJsonString(JsonUtil.WriterOptions));
    }

    private static JsonObject CreateServer(string id, string name, string detailsUrlTemplate, string watchUrlTemplate) => new()
    {
        ["id"] = id,
        ["name"] = name,
        ["detailsUrlTemplate"] = detailsUrlTemplate,
        ["watchUrlTemplate"] = watchUrlTemplate
    };

    private static string LegacyWatchTemplate(string detailsUrlTemplate)
    {
        var separator = detailsUrlTemplate.Contains('?') ? "&" : "?";
        return $"{detailsUrlTemplate}{separator}ep=<episode>";
    }

    private static string ReadRequiredInputString(JsonObject input, string name, string error)
    {
        var value = ReadOptionalInputString(input, name, error);
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ApiException(error, 400);
        }
        return value;
    }

    private static string? ReadOptionalInputString(JsonObject input, string name, string error)
    {
        try
        {
            return JsonUtil.String(input, name);
        }
        catch
        {
            throw new ApiException(error, 400);
        }
    }

    private static bool ReadInputBool(JsonObject input, string name, string error)
    {
        var value = JsonUtil.Bool(input, name);
        return value ?? throw new ApiException(error, 400);
    }

    private static string? ReadSavedString(JsonNode node, string name)
    {
        try
        {
            return JsonUtil.String(node, name);
        }
        catch
        {
            return null;
        }
    }

    private static bool ReadSavedBool(JsonNode node, string name)
    {
        try
        {
            return JsonUtil.Bool(node, name) == true;
        }
        catch
        {
            return false;
        }
    }

    private static void ValidateDetailsTemplate(string value)
    {
        if (!IsValidDetailsTemplate(value))
        {
            throw new ApiException("Details URL template must be an absolute HTTP(S) URL containing <anilistid> or <malid>.", 400);
        }
    }

    private static void ValidateWatchTemplate(string value)
    {
        if (!IsValidWatchTemplate(value))
        {
            throw new ApiException("Watch URL template must be an absolute HTTP(S) URL containing <episode> and one of <anilistid> or <malid>.", 400);
        }
    }

    private static bool IsValidDetailsTemplate(string? value) =>
        IsValidUrlTemplate(value, requireEpisode: false);

    private static bool IsValidWatchTemplate(string? value) =>
        IsValidUrlTemplate(value, requireEpisode: true);

    private static bool IsValidUrlTemplate(string? value, bool requireEpisode)
    {
        if (string.IsNullOrWhiteSpace(value)
            || (!value.Contains("<anilistid>", StringComparison.OrdinalIgnoreCase)
                && !value.Contains("<malid>", StringComparison.OrdinalIgnoreCase))
            || (requireEpisode && !value.Contains("<episode>", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var exampleUrl = value.Trim()
            .Replace("<anilistid>", "1", StringComparison.OrdinalIgnoreCase)
            .Replace("<malid>", "1", StringComparison.OrdinalIgnoreCase)
            .Replace("<episode>", "1", StringComparison.OrdinalIgnoreCase);
        return Uri.TryCreate(exampleUrl, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
    }
}
