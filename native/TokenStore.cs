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
            ["appearance"] = PublicAppearance(appearance),
            ["updates"] = PublicUpdates(config["updates"] as JsonObject)
        };
    }

    public JsonObject SavePublicSettings(JsonObject? appearanceInput = null, JsonObject? updatesInput = null, bool? showNotes = null)
    {
        var config = paths.ReadPortableConfig();
        if (showNotes.HasValue)
        {
            config["showNotes"] = showNotes.Value;
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
        config["updatedAt"] = DateTimeOffset.UtcNow.ToString("O");
        paths.WritePortableConfig(config);
        return ReadPublicSettings();
    }

    private static JsonObject PublicAppearance(JsonObject? appearance) => new()
    {
        ["colorMode"] = NormalizedAppearanceValue(JsonUtil.String(appearance ?? new JsonObject(), "colorMode"), ColorModes, "soft"),
        ["accentTheme"] = NormalizedAppearanceValue(JsonUtil.String(appearance ?? new JsonObject(), "accentTheme"), AccentThemes, "teal"),
        ["alertIcon"] = NormalizedAppearanceValue(JsonUtil.String(appearance ?? new JsonObject(), "alertIcon"), AlertIcons, "green-dot"),
        ["showSynonymInfoIcon"] = JsonUtil.Bool(appearance ?? new JsonObject(), "showSynonymInfoIcon") ?? true
    };

    private static JsonObject PublicUpdates(JsonObject? updates) => new()
    {
        ["autoCheckEnabled"] = JsonUtil.Bool(updates ?? new JsonObject(), "autoCheckEnabled") ?? true
    };

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
