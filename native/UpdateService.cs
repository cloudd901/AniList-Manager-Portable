using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace AniListManagerPortable;

internal sealed partial class UpdateService(HttpClient http, AppPaths paths)
{
    private static readonly string GitHubOwner = string.Join("", ["cloud", "d901"]);
    private static readonly string ReleasesLatestUrl = $"https://api.github.com/repos/{GitHubOwner}/AniList-Manager-Portable/releases/latest";
    private static readonly string ReleasesTagsUrl = $"https://api.github.com/repos/{GitHubOwner}/AniList-Manager-Portable/releases/tags/";
    private const string UserAgent = "AniListManagerPortable/1.0";
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(24);

    public async Task<JsonObject> GetAsync(bool force, CancellationToken cancellationToken)
    {
        var config = paths.ReadPortableConfig();
        var updates = ReadUpdates(config);
        var autoCheckEnabled = JsonUtil.Bool(updates, "autoCheckEnabled") ?? true;
        var lastCheckedAt = ReadDate(JsonUtil.String(updates, "lastCheckedAt"));
        var due = lastCheckedAt is null || DateTimeOffset.UtcNow - lastCheckedAt.Value >= CheckInterval;

        if (!force && (!autoCheckEnabled || !due))
        {
            return BuildState(updates, "cached", null);
        }

        try
        {
            var release = await FetchLatestReleaseAsync(cancellationToken);
            updates["cachedRelease"] = release;
            var currentRelease = await FetchCurrentReleaseAsync(CurrentVersion(), release, cancellationToken);
            if (currentRelease is not null)
            {
                updates["cachedCurrentRelease"] = currentRelease;
            }
            updates["lastCheckedAt"] = DateTimeOffset.UtcNow.ToString("O");
            config["updates"] = updates;
            paths.WritePortableConfig(config);
            return BuildState(updates, "checked", null);
        }
        catch (Exception error)
        {
            if (force)
            {
                updates.Remove("cachedRelease");
                updates.Remove("ignoredVersion");
            }
            updates["lastCheckedAt"] = DateTimeOffset.UtcNow.ToString("O");
            config["updates"] = updates;
            paths.WritePortableConfig(config);
            return BuildState(updates, "error", error.Message);
        }
    }

    public JsonObject IgnoreLatest()
    {
        var config = paths.ReadPortableConfig();
        var updates = ReadUpdates(config);
        var release = updates["cachedRelease"] as JsonObject;
        var version = JsonUtil.String(release, "version");
        if (string.IsNullOrWhiteSpace(version))
        {
            throw new ApiException("No update version is available to ignore.", 409);
        }

        updates["ignoredVersion"] = version;
        config["updates"] = updates;
        paths.WritePortableConfig(config);
        return BuildState(updates, "ignored", null);
    }

    private async Task<JsonObject> FetchLatestReleaseAsync(CancellationToken cancellationToken)
    {
        using var request = CreateGitHubRequest(ReleasesLatestUrl);
        using var response = await http.SendAsync(request, cancellationToken);
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"GitHub update check failed with HTTP {(int)response.StatusCode}.");
        }

        return ParseRelease(body);
    }

    private async Task<JsonObject?> FetchCurrentReleaseAsync(string currentVersion, JsonObject latestRelease, CancellationToken cancellationToken)
    {
        if (string.Equals(JsonUtil.String(latestRelease, "version"), currentVersion, StringComparison.OrdinalIgnoreCase))
        {
            return latestRelease.DeepClone() as JsonObject;
        }

        foreach (var tag in new[] { $"v{currentVersion}", currentVersion })
        {
            using var request = CreateGitHubRequest(ReleasesTagsUrl + Uri.EscapeDataString(tag));
            using var response = await http.SendAsync(request, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                continue;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            try
            {
                return ParseRelease(body);
            }
            catch
            {
                return null;
            }
        }

        return null;
    }

    private static HttpRequestMessage CreateGitHubRequest(string url)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2026-03-10");
        return request;
    }

    private static JsonObject ParseRelease(string body)
    {
        var release = JsonNode.Parse(body) as JsonObject
            ?? throw new InvalidOperationException("GitHub returned an invalid release response.");
        var tagName = JsonUtil.String(release, "tag_name") ?? "";
        var normalizedVersion = NormalizeVersion(tagName);
        if (normalizedVersion is null)
        {
            throw new InvalidOperationException($"GitHub release tag '{tagName}' is not a stable semantic version.");
        }

        var asset = FindDownloadAsset(release["assets"] as JsonArray);
        return new JsonObject
        {
            ["tagName"] = tagName,
            ["version"] = normalizedVersion,
            ["name"] = JsonUtil.String(release, "name"),
            ["body"] = JsonUtil.String(release, "body") ?? "",
            ["htmlUrl"] = JsonUtil.String(release, "html_url"),
            ["publishedAt"] = JsonUtil.String(release, "published_at"),
            ["assetName"] = JsonUtil.String(asset, "name"),
            ["downloadUrl"] = JsonUtil.String(asset, "browser_download_url")
        };
    }

    private static JsonObject BuildState(JsonObject updates, string status, string? error)
    {
        var release = updates["cachedRelease"] as JsonObject;
        var currentRelease = updates["cachedCurrentRelease"] as JsonObject;
        var currentVersion = CurrentVersion();
        var latestVersion = JsonUtil.String(release, "version");
        if (currentRelease is null && string.Equals(currentVersion, latestVersion, StringComparison.OrdinalIgnoreCase))
        {
            currentRelease = release;
        }
        var comparison = CompareVersions(currentVersion, latestVersion);
        var updateAvailable = comparison > 0;
        var ignoredVersion = JsonUtil.String(updates, "ignoredVersion");
        var ignored = updateAvailable
            && NormalizeVersion(ignoredVersion) is { } normalizedIgnored
            && string.Equals(normalizedIgnored, latestVersion, StringComparison.OrdinalIgnoreCase);

        return new JsonObject
        {
            ["currentVersion"] = currentVersion,
            ["currentTagName"] = JsonUtil.String(currentRelease, "tagName"),
            ["currentReleaseName"] = JsonUtil.String(currentRelease, "name"),
            ["currentReleaseNotes"] = JsonUtil.String(currentRelease, "body") ?? "",
            ["currentReleaseUrl"] = JsonUtil.String(currentRelease, "htmlUrl"),
            ["currentPublishedAt"] = JsonUtil.String(currentRelease, "publishedAt"),
            ["latestVersion"] = latestVersion,
            ["latestTagName"] = JsonUtil.String(release, "tagName"),
            ["releaseName"] = JsonUtil.String(release, "name"),
            ["releaseNotes"] = JsonUtil.String(release, "body") ?? "",
            ["releaseUrl"] = JsonUtil.String(release, "htmlUrl"),
            ["publishedAt"] = JsonUtil.String(release, "publishedAt"),
            ["assetName"] = JsonUtil.String(release, "assetName"),
            ["downloadUrl"] = JsonUtil.String(release, "downloadUrl"),
            ["updateAvailable"] = updateAvailable,
            ["ignored"] = ignored,
            ["autoCheckEnabled"] = JsonUtil.Bool(updates, "autoCheckEnabled") ?? true,
            ["lastCheckedAt"] = JsonUtil.String(updates, "lastCheckedAt"),
            ["ignoredVersion"] = ignoredVersion,
            ["status"] = status,
            ["error"] = error
        };
    }

    private static JsonObject ReadUpdates(JsonObject config)
    {
        var updates = config["updates"]?.DeepClone() as JsonObject ?? new JsonObject();
        if (!updates.ContainsKey("autoCheckEnabled"))
        {
            updates["autoCheckEnabled"] = true;
        }
        return updates;
    }

    private static JsonObject? FindDownloadAsset(JsonArray? assets)
    {
        if (assets is null)
        {
            return null;
        }

        return assets
            .OfType<JsonObject>()
            .FirstOrDefault(asset => AssetNameRegex().IsMatch(JsonUtil.String(asset, "name") ?? ""));
    }

    private static int CompareVersions(string? currentVersion, string? latestVersion)
    {
        var current = ParseVersion(currentVersion);
        var latest = ParseVersion(latestVersion);
        if (current is null || latest is null)
        {
            return 0;
        }

        return latest.CompareTo(current);
    }

    private static Version? ParseVersion(string? value)
    {
        var normalized = NormalizeVersion(value);
        return normalized is not null && Version.TryParse(normalized, out var version) ? version : null;
    }

    private static string? NormalizeVersion(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var normalized = value.Trim();
        if (normalized.StartsWith("v", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized[1..];
        }

        return StableVersionRegex().IsMatch(normalized) ? normalized : null;
    }

    private static DateTimeOffset? ReadDate(string? value) =>
        DateTimeOffset.TryParse(value, out var parsed) ? parsed : null;

    private static string CurrentVersion()
    {
        var assembly = typeof(UpdateService).Assembly;
        var informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        var normalized = NormalizeVersion(informational?.Split('+')[0]);
        if (normalized is not null)
        {
            return normalized;
        }

        var version = assembly.GetName().Version ?? new Version(1, 0, 0);
        return $"{version.Major}.{version.Minor}.{version.Build}";
    }

    [GeneratedRegex(@"^\d+\.\d+\.\d+(?:\.\d+)?$", RegexOptions.CultureInvariant)]
    private static partial Regex StableVersionRegex();

    [GeneratedRegex(@"^AniListManagerPortable-.+-win-x64\.zip$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AssetNameRegex();
}
