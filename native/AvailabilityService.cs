using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace AniListManagerPortable;

internal sealed class AvailabilityService(HttpClient http, AppPaths paths)
{
    private const string HostedApi = "https://allanime-api.shashankbhake.codes";
    private const string AllAnimeGraphQl = "https://api.allanime.day/api";
    private const string JikanApi = "https://api.jikan.moe/v4/anime";
    private static readonly TimeSpan CacheTtl = TimeSpan.FromHours(24);
    private static readonly TimeSpan MalSuccessTtl = TimeSpan.FromDays(30);
    private static readonly TimeSpan MalFailureTtl = TimeSpan.FromHours(24);
    private static readonly TimeSpan MalRateLimitFailureTtl = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan JikanRateLimitCooldown = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan JikanRequestSpacing = TimeSpan.FromMilliseconds(1100);
    private readonly object cacheLock = new();
    private readonly object overrideLock = new();
    private readonly object malCacheLock = new();
    private readonly object jikanLock = new();
    private readonly object throttleLock = new();
    private DateTimeOffset hostedProviderDisabledUntil = DateTimeOffset.MinValue;
    private DateTimeOffset providerCooldownUntil = DateTimeOffset.MinValue;
    private DateTimeOffset nextJikanRequestAt = DateTimeOffset.MinValue;
    private DateTimeOffset jikanCooldownUntil = DateTimeOffset.MinValue;
    private int providerFailureStreak;

    private sealed class JikanRateLimitException(string message) : Exception(message);
    private sealed record MatchSelection(JsonObject Candidate, double Score, string Confidence);
    private sealed record SeedAvailabilityOverride(int MediaId, int Total, int Sub, int Dub, string Note, bool ForceComplete = false);
    private static readonly SeedAvailabilityOverride[] SeedAvailabilityOverrides =
    [
        new(179062, 13, 13, 13, "Miruro verified"),
        new(20920, 13, 13, 13, "Miruro verified"),
        new(1350, 3, 3, 3, "Miruro verified"),
        new(2263, 3, 3, 3, "Miruro verified"),
        new(3086, 3, 3, 1, "Miruro verified", true),
        new(918, 201, 201, 201, "Miruro verified"),
        new(320, 2, 2, 2, "Miruro verified"),
        new(100, 13, 13, 13, "Miruro verified"),
        new(102663, 28, 28, 28, "Miruro verified")
    ];

    public JsonObject ReadCache() => JsonUtil.ReadObject(paths.AvailabilityCachePath);

    public JsonObject ReadOverrides()
    {
        EnsureOverridesSeeded();
        lock (overrideLock)
        {
            return JsonUtil.ReadObject(paths.AvailabilityOverridesPath);
        }
    }

    public void WriteCache(JsonObject cache)
    {
        Directory.CreateDirectory(paths.DataDir);
        File.WriteAllText(paths.AvailabilityCachePath, cache.ToJsonString(JsonUtil.WriterOptions));
    }

    public JsonObject SaveOverride(int mediaId, JsonObject input)
    {
        var total = JsonUtil.Int(input, "totalEpisodes");
        var sub = JsonUtil.Int(input, "subEpisodes") ?? 0;
        var dub = JsonUtil.Int(input, "dubEpisodes") ?? 0;
        if (mediaId <= 0)
        {
            throw new ApiException("Invalid media id.", 400);
        }
        if (total is not > 0)
        {
            throw new ApiException("totalEpisodes must be greater than zero.", 400);
        }
        if (sub < 0 || dub < 0)
        {
            throw new ApiException("Episode counts cannot be negative.", 400);
        }

        var now = DateTimeOffset.UtcNow.ToString("O");
        var note = JsonUtil.String(input, "note")?.Trim();
        var matchedTitle = JsonUtil.String(input, "matchedTitle")?.Trim();
        var forceComplete = JsonUtil.Bool(input, "forceComplete") == true;
        var forceAiring = JsonUtil.Bool(input, "forceAiring") == true;
        var saved = new JsonObject
        {
            ["mediaId"] = mediaId,
            ["totalEpisodes"] = total,
            ["subEpisodes"] = sub,
            ["dubEpisodes"] = dub,
            ["note"] = string.IsNullOrWhiteSpace(note) ? null : note,
            ["matchedTitle"] = string.IsNullOrWhiteSpace(matchedTitle) ? null : matchedTitle,
            ["forceComplete"] = forceComplete,
            ["forceAiring"] = forceAiring,
            ["updatedAt"] = now
        };

        lock (overrideLock)
        {
            var overrides = ReadOverridesUnlocked();
            overrides[mediaId.ToString()] = saved.DeepClone();
            WriteOverridesUnlocked(overrides);
        }

        var result = BuildOverrideResult(mediaId, saved);
        lock (cacheLock)
        {
            var cache = ReadCache();
            cache[mediaId.ToString()] = result.DeepClone();
            WriteCache(cache);
        }
        return result;
    }

    public void DeleteOverride(int mediaId)
    {
        if (mediaId <= 0)
        {
            throw new ApiException("Invalid media id.", 400);
        }

        lock (overrideLock)
        {
            var overrides = ReadOverridesUnlocked();
            overrides.Remove(mediaId.ToString());
            WriteOverridesUnlocked(overrides);
        }

        RemoveCachedAvailability(mediaId);
    }

    public void RemoveCachedAvailability(int mediaId)
    {
        lock (cacheLock)
        {
            var cache = ReadCache();
            cache.Remove(mediaId.ToString());
            WriteCache(cache);
        }
    }

    public async Task<JsonObject?> ResolveAsync(JsonObject entry, bool refresh, JsonObject cache, CancellationToken cancellationToken, bool force = false)
    {
        var mediaId = JsonUtil.Int(entry, "mediaId") ?? throw new ApiException("Availability entry is missing mediaId.", 400);
        if (TryGetOverrideResult(entry) is { } overrideResult)
        {
            lock (cacheLock)
            {
                cache[mediaId.ToString()] = overrideResult.DeepClone();
            }
            return overrideResult;
        }

        if (IsUnreleased(entry))
        {
            return null;
        }

        if (!force)
        {
            var reusableCached = GetReusableCachedResult(entry, refresh, cache);
            if (reusableCached is not null)
            {
                return reusableCached;
            }
        }

        var cacheKey = mediaId.ToString();

        var checkedAt = DateTimeOffset.UtcNow.ToString("O");
        JsonObject? malInfo = null;
        foreach (var title in AvailabilityTitles(entry))
        {
            var candidates = await ProviderSearchAsync(title, cancellationToken);
            var match = SelectMatch(entry, candidates, title);
            if (ShouldFetchMalForMatch(entry, match))
            {
                malInfo ??= await ResolveMalInfoAsync(entry, cancellationToken);
                var malEpisodes = JsonUtil.Int(malInfo, "episodes");
                if (malEpisodes is > 0)
                {
                    match = SelectMatch(entry, candidates, title, malEpisodes);
                }
            }

            if (match is not null)
            {
                var subEpisodes = JsonUtil.Int(match.Candidate, "episodes_sub") ?? 0;
                var dubEpisodes = JsonUtil.Int(match.Candidate, "episodes_dub") ?? 0;
                var dubCappedToSub = false;
                if (subEpisodes > 0 && dubEpisodes > subEpisodes)
                {
                    dubEpisodes = subEpisodes;
                    dubCappedToSub = true;
                }
                var totalInfo = CorrectedTotal(entry, malInfo, subEpisodes, dubEpisodes);
                if (totalInfo.Total > 0 && totalInfo.Total < Math.Max(subEpisodes, dubEpisodes))
                {
                    subEpisodes = Math.Min(subEpisodes, totalInfo.Total);
                    dubEpisodes = Math.Min(dubEpisodes, totalInfo.Total);
                }
                var result = ApplyCachePolicy(entry, new JsonObject
                {
                    ["mediaId"] = mediaId,
                    ["malId"] = JsonUtil.Int(entry, "malId"),
                    ["subEpisodes"] = subEpisodes,
                    ["dubEpisodes"] = dubEpisodes,
                    ["totalEpisodes"] = totalInfo.Total > 0 ? totalInfo.Total : null,
                    ["source"] = "anime-api",
                    ["matchedTitle"] = JsonUtil.String(match.Candidate, "title"),
                    ["checkedAt"] = checkedAt,
                    ["status"] = "found",
                    ["totalSource"] = totalInfo.Source,
                    ["malEpisodes"] = totalInfo.MalEpisodes,
                    ["matchConfidence"] = match.Confidence,
                    ["dubCappedToSub"] = dubCappedToSub
                });
                lock (cacheLock)
                {
                    cache[cacheKey] = result.DeepClone();
                }
                return result;
            }
        }

        malInfo ??= await ResolveMalInfoAsync(entry, cancellationToken);
        var fallbackTotal = CorrectedTotal(entry, malInfo, 0, 0);
        var fallback = ApplyCachePolicy(entry, new JsonObject
        {
            ["mediaId"] = mediaId,
            ["malId"] = JsonUtil.Int(entry, "malId"),
            ["subEpisodes"] = fallbackTotal.Total > 0 ? fallbackTotal.Total : null,
            ["dubEpisodes"] = 0,
            ["totalEpisodes"] = fallbackTotal.Total > 0 ? fallbackTotal.Total : null,
            ["source"] = fallbackTotal.Total > 0 ? $"{fallbackTotal.Source}-total-fallback" : "anime-api",
            ["matchedTitle"] = null,
            ["checkedAt"] = checkedAt,
            ["status"] = fallbackTotal.Total > 0 ? "found" : "not_found",
            ["totalSource"] = fallbackTotal.Source,
            ["malEpisodes"] = fallbackTotal.MalEpisodes,
            ["matchConfidence"] = "low"
        });
        lock (cacheLock)
        {
            cache[cacheKey] = fallback.DeepClone();
        }
        return fallback;
    }

    public JsonObject? GetReusableCachedResult(JsonObject entry, bool refresh, JsonObject cache)
    {
        var mediaId = JsonUtil.Int(entry, "mediaId");
        if (mediaId is null)
        {
            return null;
        }

        if (TryGetOverrideResult(entry) is { } overrideResult)
        {
            lock (cacheLock)
            {
                cache[mediaId.Value.ToString()] = overrideResult.DeepClone();
            }
            return overrideResult;
        }

        if (IsUnreleased(entry))
        {
            return null;
        }

        lock (cacheLock)
        {
            if (cache[mediaId.Value.ToString()] is not JsonObject cached)
            {
                return null;
            }

            if (IsCacheReusable(entry, cached, refresh))
            {
                return cached.DeepClone().AsObject();
            }
        }

        return null;
    }

    public JsonObject? GetCachedResult(JsonObject entry, JsonObject cache)
    {
        var mediaId = JsonUtil.Int(entry, "mediaId");
        if (mediaId is null)
        {
            return null;
        }

        if (TryGetOverrideResult(entry) is { } overrideResult)
        {
            lock (cacheLock)
            {
                cache[mediaId.Value.ToString()] = overrideResult.DeepClone();
            }
            return overrideResult;
        }

        if (IsUnreleased(entry))
        {
            return null;
        }

        lock (cacheLock)
        {
            return cache[mediaId.Value.ToString()] is JsonObject cached
                ? cached.DeepClone().AsObject()
                : null;
        }
    }

    public bool SuppressesAutomaticAvailability(JsonObject entry)
    {
        return IsUnreleased(entry) && TryGetOverrideResult(entry) is null;
    }

    public JsonObject ErrorResult(JsonObject entry, Exception error)
    {
        return new JsonObject
        {
            ["mediaId"] = JsonUtil.Int(entry, "mediaId"),
            ["malId"] = JsonUtil.Int(entry, "malId"),
            ["subEpisodes"] = null,
            ["dubEpisodes"] = null,
            ["totalEpisodes"] = JsonUtil.Int(entry, "totalEpisodes"),
            ["source"] = "anime-api",
            ["matchedTitle"] = null,
            ["checkedAt"] = DateTimeOffset.UtcNow.ToString("O"),
            ["status"] = "error",
            ["cachePermanent"] = false,
            ["cacheExpiresAt"] = DateTimeOffset.UtcNow.Add(CacheTtl).ToString("O")
        };
    }

    public async Task<JsonObject> ResolveRatingsAsync(JsonArray entries, CancellationToken cancellationToken, bool cacheOnly = false)
    {
        if (cacheOnly)
        {
            return ResolveSavedRatings(entries);
        }

        var results = new JsonArray();
        var rateLimited = false;
        foreach (var entry in entries.OfType<JsonObject>())
        {
            var mediaId = JsonUtil.Int(entry, "mediaId");
            var malId = JsonUtil.Int(entry, "malId");
            if (mediaId is null || malId is null)
            {
                results.Add((JsonNode?)new JsonObject
                {
                    ["mediaId"] = mediaId,
                    ["malId"] = malId,
                    ["rating"] = null,
                    ["ratingLabel"] = null,
                    ["status"] = "missing_mal_id",
                    ["cached"] = false
                });
                continue;
            }

            var (malInfo, cached) = await ResolveMalInfoAsync(malId.Value, cancellationToken, true);
            results.Add((JsonNode?)new JsonObject
            {
                ["mediaId"] = mediaId,
                ["malId"] = malId,
                ["rating"] = JsonUtil.String(malInfo, "rating"),
                ["ratingLabel"] = JsonUtil.String(malInfo, "ratingLabel"),
                ["status"] = JsonUtil.String(malInfo, "status") ?? "error",
                ["cached"] = cached
            });
            if (IsRateLimitedMalInfo(malInfo))
            {
                rateLimited = true;
                break;
            }
        }

        return new JsonObject
        {
            ["entries"] = results,
            ["rateLimited"] = rateLimited
        };
    }

    private JsonObject ResolveSavedRatings(JsonArray entries)
    {
        JsonObject cache;
        lock (malCacheLock)
        {
            cache = JsonUtil.ReadObject(paths.MalCachePath);
        }

        var results = new JsonArray();
        foreach (var entry in entries.OfType<JsonObject>())
        {
            var mediaId = JsonUtil.Int(entry, "mediaId");
            var malId = JsonUtil.Int(entry, "malId");
            if (mediaId is null || malId is null ||
                cache[malId.Value.ToString()] is not JsonObject saved ||
                !IsSavedRatingUsable(saved))
            {
                continue;
            }

            results.Add((JsonNode?)new JsonObject
            {
                ["mediaId"] = mediaId,
                ["malId"] = malId,
                ["rating"] = JsonUtil.String(saved, "rating"),
                ["ratingLabel"] = JsonUtil.String(saved, "ratingLabel"),
                ["status"] = JsonUtil.String(saved, "status"),
                ["cached"] = true
            });
        }

        return new JsonObject
        {
            ["entries"] = results,
            ["rateLimited"] = false
        };
    }

    private JsonObject? TryGetOverrideResult(JsonObject entry)
    {
        var mediaId = JsonUtil.Int(entry, "mediaId");
        if (mediaId is null)
        {
            return null;
        }

        JsonObject? saved;
        lock (overrideLock)
        {
            var overrides = ReadOverridesUnlocked();
            saved = overrides[mediaId.Value.ToString()] as JsonObject;
            if (saved is null)
            {
                return null;
            }
            saved = saved.DeepClone().AsObject();
        }

        var result = BuildOverrideResult(mediaId.Value, saved);
        var malId = JsonUtil.Int(entry, "malId");
        if (malId is not null)
        {
            result["malId"] = malId;
        }
        return result;
    }

    private static JsonObject BuildOverrideResult(int mediaId, JsonObject saved)
    {
        var matchedTitle = JsonUtil.String(saved, "matchedTitle");
        if (string.IsNullOrWhiteSpace(matchedTitle))
        {
            matchedTitle = JsonUtil.String(saved, "note");
        }

        return new JsonObject
        {
            ["mediaId"] = mediaId,
            ["malId"] = null,
            ["subEpisodes"] = JsonUtil.Int(saved, "subEpisodes") ?? 0,
            ["dubEpisodes"] = JsonUtil.Int(saved, "dubEpisodes") ?? 0,
            ["totalEpisodes"] = JsonUtil.Int(saved, "totalEpisodes"),
            ["source"] = "local-override",
            ["matchedTitle"] = string.IsNullOrWhiteSpace(matchedTitle) ? "Local override" : matchedTitle,
            ["checkedAt"] = JsonUtil.String(saved, "updatedAt") ?? DateTimeOffset.UtcNow.ToString("O"),
            ["status"] = "found",
            ["totalSource"] = "override",
            ["malEpisodes"] = null,
            ["matchConfidence"] = "high",
            ["note"] = JsonUtil.String(saved, "note"),
            ["forceComplete"] = JsonUtil.Bool(saved, "forceComplete") == true,
            ["forceAiring"] = JsonUtil.Bool(saved, "forceAiring") == true,
            ["override"] = true,
            ["cachePermanent"] = true,
            ["cacheExpiresAt"] = null
        };
    }

    private void EnsureOverridesSeeded()
    {
        lock (overrideLock)
        {
            if (File.Exists(paths.AvailabilityOverridesPath))
            {
                return;
            }

            var now = DateTimeOffset.UtcNow.ToString("O");
            var overrides = new JsonObject();
            foreach (var seed in SeedAvailabilityOverrides)
            {
                overrides[seed.MediaId.ToString()] = new JsonObject
                {
                    ["mediaId"] = seed.MediaId,
                    ["totalEpisodes"] = seed.Total,
                    ["subEpisodes"] = seed.Sub,
                    ["dubEpisodes"] = seed.Dub,
                    ["note"] = seed.Note,
                    ["matchedTitle"] = seed.Note,
                    ["forceComplete"] = seed.ForceComplete,
                    ["forceAiring"] = false,
                    ["updatedAt"] = now
                };
            }
            WriteOverridesUnlocked(overrides);
        }
    }

    private JsonObject ReadOverridesUnlocked()
    {
        if (!File.Exists(paths.AvailabilityOverridesPath))
        {
            var now = DateTimeOffset.UtcNow.ToString("O");
            var overrides = new JsonObject();
            foreach (var seed in SeedAvailabilityOverrides)
            {
                overrides[seed.MediaId.ToString()] = new JsonObject
                {
                    ["mediaId"] = seed.MediaId,
                    ["totalEpisodes"] = seed.Total,
                    ["subEpisodes"] = seed.Sub,
                    ["dubEpisodes"] = seed.Dub,
                    ["note"] = seed.Note,
                    ["matchedTitle"] = seed.Note,
                    ["forceComplete"] = seed.ForceComplete,
                    ["forceAiring"] = false,
                    ["updatedAt"] = now
                };
            }
            WriteOverridesUnlocked(overrides);
            return overrides;
        }

        var existing = JsonUtil.ReadObject(paths.AvailabilityOverridesPath);
        var changed = false;
        var seedForceComplete = SeedAvailabilityOverrides.ToDictionary(seed => seed.MediaId.ToString(), seed => seed.ForceComplete);
        foreach (var item in existing.ToArray())
        {
            if (item.Value is not JsonObject saved)
            {
                continue;
            }

            if (saved["forceComplete"] is null)
            {
                saved["forceComplete"] = seedForceComplete.TryGetValue(item.Key, out var forceComplete) && forceComplete;
                changed = true;
            }
            if (saved["forceAiring"] is null)
            {
                saved["forceAiring"] = false;
                changed = true;
            }
        }

        if (changed)
        {
            WriteOverridesUnlocked(existing);
        }
        return existing;
    }

    private void WriteOverridesUnlocked(JsonObject overrides)
    {
        Directory.CreateDirectory(paths.DataDir);
        File.WriteAllText(paths.AvailabilityOverridesPath, overrides.ToJsonString(JsonUtil.WriterOptions));
    }

    private static bool ShouldFetchMalForMatch(JsonObject entry, MatchSelection? match)
    {
        if (!IsFinished(entry) || JsonUtil.Int(entry, "malId") is null)
        {
            return false;
        }

        if (match is null)
        {
            return true;
        }

        var providerMax = Math.Max(JsonUtil.Int(match.Candidate, "episodes_sub") ?? 0, JsonUtil.Int(match.Candidate, "episodes_dub") ?? 0);
        var entryTotal = JsonUtil.Int(entry, "totalEpisodes") ?? 0;
        if (entryTotal <= 0 || providerMax <= 0)
        {
            return true;
        }

        if (match.Confidence != "high")
        {
            return true;
        }

        return Math.Abs(providerMax - entryTotal) > 1;
    }

    private async Task<JsonObject?> ResolveMalInfoAsync(JsonObject entry, CancellationToken cancellationToken)
    {
        if (!IsFinished(entry) || JsonUtil.Int(entry, "malId") is not { } malId)
        {
            return null;
        }

        var (result, _) = await ResolveMalInfoAsync(malId, cancellationToken);
        return JsonUtil.String(result, "status") == "found" ? result : null;
    }

    private async Task<(JsonObject Result, bool Cached)> ResolveMalInfoAsync(int malId, CancellationToken cancellationToken, bool requireRating = false)
    {
        var key = malId.ToString();
        lock (malCacheLock)
        {
            var cache = JsonUtil.ReadObject(paths.MalCachePath);
            if (cache[key] is JsonObject cached &&
                (requireRating ? IsSavedRatingUsable(cached) : IsMalCacheUsable(cached)))
            {
                return (cached.DeepClone().AsObject(), true);
            }
        }

        try
        {
            await WaitForJikanSlotAsync(cancellationToken);
            using var request = new HttpRequestMessage(HttpMethod.Get, $"{JikanApi}/{malId}");
            request.Headers.UserAgent.ParseAdd("AniList Manager local MAL metadata checker");
            request.Headers.Accept.ParseAdd("application/json");
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(8));
            using var response = await http.SendAsync(request, timeout.Token);
            var text = await response.Content.ReadAsStringAsync(timeout.Token);
            var payload = JsonNode.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text) as JsonObject;
            if ((int)response.StatusCode == 429)
            {
                StartJikanCooldown(response.Headers.RetryAfter?.Delta);
                throw new JikanRateLimitException("Jikan returned 429");
            }
            if (!response.IsSuccessStatusCode || payload?["data"] is not JsonObject data)
            {
                throw new InvalidOperationException($"Jikan returned {(int)response.StatusCode}");
            }

            var result = new JsonObject
            {
                ["malId"] = malId,
                ["episodes"] = JsonUtil.Int(data, "episodes"),
                ["type"] = JsonUtil.String(data, "type"),
                ["title"] = JsonUtil.String(data, "title"),
                ["rating"] = JsonUtil.String(data, "rating"),
                ["ratingLabel"] = NormalizeMalRating(JsonUtil.String(data, "rating")),
                ["checkedAt"] = DateTimeOffset.UtcNow.ToString("O"),
                ["status"] = "found"
            };
            WriteMalCacheEntry(key, result);
            return (result, false);
        }
        catch (Exception error)
        {
            var failed = new JsonObject
            {
                ["malId"] = malId,
                ["episodes"] = null,
                ["type"] = null,
                ["title"] = null,
                ["rating"] = null,
                ["ratingLabel"] = null,
                ["checkedAt"] = DateTimeOffset.UtcNow.ToString("O"),
                ["status"] = "error",
                ["failureKind"] = error is JikanRateLimitException ? "rate_limited" : "error",
                ["error"] = error.Message
            };
            WriteMalCacheEntry(key, failed);
            return (failed, false);
        }
    }

    private static string? NormalizeMalRating(string? rating)
    {
        if (string.IsNullOrWhiteSpace(rating))
        {
            return null;
        }

        var normalized = rating.Trim();
        var separator = normalized.IndexOf(" - ", StringComparison.Ordinal);
        if (separator > 0)
        {
            normalized = normalized[..separator].Trim();
        }

        return normalized.Equals("None", StringComparison.OrdinalIgnoreCase) ||
            normalized.Equals("Unknown", StringComparison.OrdinalIgnoreCase)
            ? null
            : normalized;
    }

    private async Task WaitForJikanSlotAsync(CancellationToken cancellationToken)
    {
        TimeSpan delay;
        lock (jikanLock)
        {
            var nextAllowedAt = nextJikanRequestAt > jikanCooldownUntil ? nextJikanRequestAt : jikanCooldownUntil;
            delay = nextAllowedAt - DateTimeOffset.UtcNow;
            if (delay <= TimeSpan.Zero)
            {
                nextJikanRequestAt = DateTimeOffset.UtcNow.Add(JikanRequestSpacing);
            }
        }

        if (delay > TimeSpan.Zero)
        {
            await Task.Delay(delay, cancellationToken);
            lock (jikanLock)
            {
                nextJikanRequestAt = DateTimeOffset.UtcNow.Add(JikanRequestSpacing);
            }
        }
    }

    private void StartJikanCooldown(TimeSpan? retryAfter)
    {
        var delay = retryAfter is { } retryDelay && retryDelay > TimeSpan.Zero ? retryDelay : JikanRateLimitCooldown;
        lock (jikanLock)
        {
            var cooldownUntil = DateTimeOffset.UtcNow.Add(delay);
            if (cooldownUntil > jikanCooldownUntil)
            {
                jikanCooldownUntil = cooldownUntil;
            }
            if (cooldownUntil > nextJikanRequestAt)
            {
                nextJikanRequestAt = cooldownUntil;
            }
        }
    }

    private void WriteMalCacheEntry(string key, JsonObject value)
    {
        lock (malCacheLock)
        {
            var cache = JsonUtil.ReadObject(paths.MalCachePath);
            cache[key] = value.DeepClone();
            Directory.CreateDirectory(paths.DataDir);
            File.WriteAllText(paths.MalCachePath, cache.ToJsonString(JsonUtil.WriterOptions));
        }
    }

    private static bool IsMalCacheUsable(JsonObject cached)
    {
        var checkedAtText = JsonUtil.String(cached, "checkedAt");
        if (!DateTimeOffset.TryParse(checkedAtText, out var checkedAt))
        {
            return false;
        }

        var ttl = JsonUtil.String(cached, "status") == "found"
            ? MalSuccessTtl
            : IsRateLimitedMalInfo(cached) ? MalRateLimitFailureTtl : MalFailureTtl;
        return DateTimeOffset.UtcNow - checkedAt < ttl;
    }

    private static bool HasRatingCacheShape(JsonObject cached) =>
        cached.ContainsKey("rating") && cached.ContainsKey("ratingLabel");

    private static bool IsSavedRatingUsable(JsonObject cached) =>
        JsonUtil.String(cached, "status") == "found" && HasRatingCacheShape(cached);

    private static bool IsRateLimitedMalInfo(JsonObject cached) =>
        JsonUtil.String(cached, "failureKind") == "rate_limited" ||
        (JsonUtil.String(cached, "error")?.Contains("429", StringComparison.Ordinal) == true);

    private static (int Total, string Source, int? MalEpisodes) CorrectedTotal(JsonObject entry, JsonObject? malInfo, int subEpisodes, int dubEpisodes)
    {
        var malEpisodes = JsonUtil.Int(malInfo, "episodes");
        if (IsFinished(entry) && malEpisodes is > 0)
        {
            return (malEpisodes.Value, "mal", malEpisodes);
        }

        var entryTotal = JsonUtil.Int(entry, "totalEpisodes");
        var providerMax = Math.Max(subEpisodes, dubEpisodes);
        if (entryTotal is > 0)
        {
            return (CorrectFinishedTvOffByOneTotal(entry, entryTotal, subEpisodes, dubEpisodes), "anilist", malEpisodes);
        }

        return (providerMax, providerMax > 0 ? "provider" : "fallback", malEpisodes);
    }

    private static int CorrectFinishedTvOffByOneTotal(JsonObject entry, int? entryTotal, int subEpisodes, int dubEpisodes)
    {
        var providerMax = Math.Max(subEpisodes, dubEpisodes);
        if (entryTotal is not > 0)
        {
            return providerMax;
        }

        if (IsFinishedTv(entry) && providerMax > 0 && entryTotal.Value == providerMax + 1)
        {
            return providerMax;
        }
        if (IsFinishedTv(entry) && subEpisodes > 0 && entryTotal.Value == subEpisodes + 1)
        {
            return subEpisodes;
        }

        return entryTotal.Value;
    }

    private static bool IsFinishedTv(JsonObject entry)
    {
        return string.Equals(JsonUtil.String(entry, "format"), "TV", StringComparison.OrdinalIgnoreCase) &&
            string.Equals(JsonUtil.String(entry, "mediaStatus"), "FINISHED", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsFinished(JsonObject entry)
    {
        return string.Equals(JsonUtil.String(entry, "mediaStatus"), "FINISHED", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsUnreleased(JsonObject entry)
    {
        return string.Equals(JsonUtil.String(entry, "mediaStatus"), "NOT_YET_RELEASED", StringComparison.OrdinalIgnoreCase);
    }

    private static JsonObject ApplyCachePolicy(JsonObject entry, JsonObject result)
    {
        var permanent = IsPermanent(entry, result);
        result["cachePermanent"] = permanent;
        result["cacheExpiresAt"] = permanent ? null : DateTimeOffset.UtcNow.Add(CacheTtl).ToString("O");
        return result;
    }

    private static bool IsCacheUsable(JsonObject entry, JsonObject cached)
    {
        if (JsonUtil.Bool(cached, "cachePermanent") == true && JsonUtil.String(cached, "matchConfidence") != "high")
        {
            return false;
        }

        if (IsPermanent(entry, cached) || (JsonUtil.Bool(cached, "cachePermanent") == true && JsonUtil.String(cached, "matchConfidence") == "high"))
        {
            return true;
        }

        var expiresAtText = JsonUtil.String(cached, "cacheExpiresAt");
        if (DateTimeOffset.TryParse(expiresAtText, out var expiresAt))
        {
            return DateTimeOffset.UtcNow < expiresAt;
        }

        var checkedAtText = JsonUtil.String(cached, "checkedAt");
        return DateTimeOffset.TryParse(checkedAtText, out var checkedAt) && DateTimeOffset.UtcNow - checkedAt < CacheTtl;
    }

    private static bool IsCacheReusable(JsonObject entry, JsonObject cached, bool refresh)
    {
        if (!refresh)
        {
            return IsCacheUsable(entry, cached);
        }

        return IsPermanent(entry, cached) || (JsonUtil.Bool(cached, "cachePermanent") == true && JsonUtil.String(cached, "matchConfidence") == "high") || HasCompleteSubDub(cached);
    }

    private static bool HasCompleteSubDub(JsonObject result)
    {
        if (JsonUtil.String(result, "status") != "found")
        {
            return false;
        }

        var total = JsonUtil.Int(result, "totalEpisodes") ?? 0;
        var sub = JsonUtil.Int(result, "subEpisodes") ?? 0;
        var dub = JsonUtil.Int(result, "dubEpisodes") ?? 0;
        return total > 0 && sub == total && dub == total && JsonUtil.String(result, "matchConfidence") == "high";
    }

    private static bool IsPermanent(JsonObject entry, JsonObject result)
    {
        if (JsonUtil.String(entry, "status") != "COMPLETED" || JsonUtil.String(result, "status") != "found")
        {
            return false;
        }

        var total = JsonUtil.Int(result, "totalEpisodes") ?? 0;
        var sub = JsonUtil.Int(result, "subEpisodes") ?? 0;
        var dub = JsonUtil.Int(result, "dubEpisodes") ?? 0;
        if (total <= 0)
        {
            return false;
        }

        if (JsonUtil.String(result, "matchConfidence") != "high")
        {
            return false;
        }

        return (sub == total && dub == total) || (sub == total && IsMoreThanThreeYearsAfterEnd(entry["endDate"] as JsonObject));
    }

    private static bool IsMoreThanThreeYearsAfterEnd(JsonObject? endDate)
    {
        var year = JsonUtil.Int(endDate, "year");
        var month = JsonUtil.Int(endDate, "month");
        var day = JsonUtil.Int(endDate, "day");
        if (year is null || month is null || day is null)
        {
            return false;
        }

        var endedAt = new DateTimeOffset(year.Value, month.Value, day.Value, 0, 0, 0, TimeSpan.Zero);
        return endedAt <= DateTimeOffset.UtcNow.AddYears(-3);
    }

    private async Task<JsonArray> ProviderSearchAsync(string query, CancellationToken cancellationToken)
    {
        Exception? lastError = null;
        for (var attempt = 0; attempt < 2; attempt += 1)
        {
            await WaitForProviderCooldownAsync(cancellationToken);
            if (DateTimeOffset.UtcNow >= hostedProviderDisabledUntil)
            {
                try
                {
                    var hostedResults = await HostedProviderSearchAsync(query, cancellationToken);
                    RecordProviderSuccess();
                    return hostedResults;
                }
                catch (Exception error)
                {
                    lastError = error;
                    RecordProviderFailure();
                    hostedProviderDisabledUntil = DateTimeOffset.UtcNow.AddMinutes(5);
                }
            }

            await WaitForProviderCooldownAsync(cancellationToken);
            try
            {
                var directResults = await DirectAllAnimeSearchAsync(query, cancellationToken);
                RecordProviderSuccess();
                return directResults;
            }
            catch (Exception error)
            {
                lastError = error;
                RecordProviderFailure();
                if (attempt == 0)
                {
                    await Task.Delay(ProviderRetryDelay(), cancellationToken);
                }
            }
        }

        throw lastError ?? new InvalidOperationException("Availability provider failed.");
    }

    private async Task WaitForProviderCooldownAsync(CancellationToken cancellationToken)
    {
        TimeSpan delay;
        lock (throttleLock)
        {
            delay = providerCooldownUntil - DateTimeOffset.UtcNow;
        }

        if (delay > TimeSpan.Zero)
        {
            await Task.Delay(delay, cancellationToken);
        }
    }

    private void RecordProviderSuccess()
    {
        lock (throttleLock)
        {
            providerFailureStreak = 0;
            providerCooldownUntil = DateTimeOffset.MinValue;
        }
    }

    private void RecordProviderFailure()
    {
        lock (throttleLock)
        {
            providerFailureStreak = Math.Min(providerFailureStreak + 1, 6);
            providerCooldownUntil = DateTimeOffset.UtcNow.Add(ProviderRetryDelay());
        }
    }

    private TimeSpan ProviderRetryDelay()
    {
        lock (throttleLock)
        {
            var seconds = Math.Min(20, Math.Pow(2, Math.Max(0, providerFailureStreak - 1)));
            return TimeSpan.FromSeconds(seconds);
        }
    }

    private async Task<JsonArray> HostedProviderSearchAsync(string query, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{HostedApi}/search?query={Uri.EscapeDataString(query)}");
        request.Headers.UserAgent.ParseAdd("AniList Manager local availability checker");
        request.Headers.Accept.ParseAdd("application/json");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(4));
        using var response = await http.SendAsync(request, timeout.Token);
        var text = await response.Content.ReadAsStringAsync(timeout.Token);
        var payload = JsonNode.Parse(string.IsNullOrWhiteSpace(text) ? "[]" : text) as JsonArray;
        if (!response.IsSuccessStatusCode || payload is null)
        {
            throw new InvalidOperationException($"Hosted availability provider returned {(int)response.StatusCode}");
        }
        return payload;
    }

    private async Task<JsonArray> DirectAllAnimeSearchAsync(string query, CancellationToken cancellationToken)
    {
        const string graphQl = "query($search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType) { shows( search: $search limit: $limit page: $page translationType: $translationType countryOrigin: $countryOrigin ) { edges { _id name availableEpisodes __typename } }}";
        var body = new JsonObject
        {
            ["variables"] = new JsonObject
            {
                ["search"] = new JsonObject
                {
                    ["allowAdult"] = false,
                    ["allowUnknown"] = false,
                    ["query"] = query
                },
                ["limit"] = 40,
                ["page"] = 1,
                ["translationType"] = "sub",
                ["countryOrigin"] = "ALL"
            },
            ["query"] = graphQl
        };

        using var request = new HttpRequestMessage(HttpMethod.Post, AllAnimeGraphQl);
        request.Headers.TryAddWithoutValidation("Referer", "https://allmanga.to");
        request.Headers.TryAddWithoutValidation("Origin", "https://allmanga.to");
        request.Headers.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0");
        request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        using var response = await http.SendAsync(request, timeout.Token);
        var text = await response.Content.ReadAsStringAsync(timeout.Token);
        var payload = JsonNode.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
        var edges = payload?["data"]?["shows"]?["edges"] as JsonArray;
        if (!response.IsSuccessStatusCode || edges is null)
        {
            throw new InvalidOperationException($"AllAnime availability provider returned {(int)response.StatusCode}");
        }

        var results = new JsonArray();
        foreach (var candidate in edges.OfType<JsonObject>())
        {
            var available = candidate["availableEpisodes"] as JsonObject ?? new JsonObject();
            results.Add((JsonNode?)new JsonObject
            {
                ["id"] = JsonUtil.String(candidate, "_id"),
                ["title"] = JsonUtil.String(candidate, "name"),
                ["episodes_sub"] = JsonUtil.Int(available, "sub") ?? 0,
                ["episodes_dub"] = JsonUtil.Int(available, "dub") ?? 0
            });
        }
        return results;
    }

    private static MatchSelection? SelectMatch(JsonObject entry, JsonArray candidates, string queryTitle, int? expectedTotalOverride = null)
    {
        var candidateTitles = AvailabilityTitles(entry).ToArray();
        JsonObject? bestMatch = null;
        double bestScore = 0;
        var querySeason = TitleSeasonNumber(queryTitle);
        var entryFormat = JsonUtil.String(entry, "format");
        var entryTotal = expectedTotalOverride ?? JsonUtil.Int(entry, "totalEpisodes") ?? 0;

        var candidateIndex = 0;
        foreach (var candidate in candidates.OfType<JsonObject>())
        {
            var candidateTitle = CleanProviderTitle(JsonUtil.String(candidate, "title") ?? JsonUtil.String(candidate, "name") ?? "");
            var subEpisodes = JsonUtil.Int(candidate, "episodes_sub") ?? 0;
            var dubEpisodes = JsonUtil.Int(candidate, "episodes_dub") ?? 0;
            var providerMalId = JsonUtil.Int(candidate, "id");
            var entryMalId = JsonUtil.Int(entry, "malId");

            if (entryMalId is not null && providerMalId == entryMalId)
            {
                var exact = candidate.DeepClone().AsObject();
                exact["title"] = candidateTitle;
                return new MatchSelection(exact, 1, "high");
            }

            var score = Math.Max(TitleScore(queryTitle, candidateTitle), candidateTitles.Select(title => TitleScore(title, candidateTitle)).DefaultIfEmpty(0).Max());
            var candidateSeason = TitleSeasonNumber(candidateTitle);
            var adjustedScore = querySeason is not null && candidateSeason is null ? score * 0.55 : score;
            var hasTailMatch = HasDistinctiveTailMatch(candidateTitles, candidateTitle);
            if (querySeason is not null && candidateSeason is null)
            {
                candidateIndex += 1;
                continue;
            }
            if (querySeason is not null && candidateSeason is not null && querySeason != candidateSeason)
            {
                candidateIndex += 1;
                continue;
            }
            if (HasForbiddenVariantMismatch(entry, queryTitle, candidateTitle))
            {
                candidateIndex += 1;
                continue;
            }
            if (hasTailMatch)
            {
                adjustedScore += 0.25;
            }
            if (HasDistinctiveTail(queryTitle) && !DistinctiveTailMatches(queryTitle, candidateTitle))
            {
                adjustedScore *= 0.35;
            }
            if (IsSeriesFormat(entryFormat) && IsStandaloneVariant(candidateTitle) && !IsStandaloneVariant(queryTitle))
            {
                adjustedScore *= 0.45;
            }
            if (entryTotal > 0)
            {
                var providerTotal = Math.Max(subEpisodes, dubEpisodes);
                if (providerTotal == entryTotal)
                {
                    adjustedScore += 0.12;
                }
                else if (providerTotal > 0 && IsSeriesFormat(entryFormat) && IsStandaloneVariant(candidateTitle))
                {
                    adjustedScore *= 0.6;
                }
            }
            adjustedScore += Math.Max(0, 0.04 - (candidateIndex * 0.006));

            if (entryTotal > 0 && Math.Max(subEpisodes, dubEpisodes) < entryTotal && IsShortNonExactQuery(queryTitle, candidateTitle))
            {
                adjustedScore *= 0.35;
            }
            if (entryTotal > 0 && HasExtraCandidateQualifier(queryTitle, candidateTitle) && Math.Max(subEpisodes, dubEpisodes) != entryTotal)
            {
                adjustedScore *= 0.45;
            }
            if (IsFinished(entry) && entryTotal > 0 && IsSeriesFormat(entryFormat) && Math.Max(subEpisodes, dubEpisodes) > 0 && Math.Max(subEpisodes, dubEpisodes) < entryTotal * 0.65)
            {
                candidateIndex += 1;
                continue;
            }

            if ((subEpisodes > 0 || dubEpisodes > 0) && adjustedScore > bestScore)
            {
                bestScore = adjustedScore;
                bestMatch = candidate.DeepClone().AsObject();
                bestMatch["title"] = candidateTitle;
            }
            candidateIndex += 1;
        }

        if (bestMatch is null || bestScore < 0.68)
        {
            return null;
        }

        var confidence = bestScore >= 0.9 ? "high" : bestScore >= 0.76 ? "medium" : "low";
        return new MatchSelection(bestMatch, bestScore, confidence);
    }

    private static IEnumerable<string> AvailabilityTitles(JsonObject entry)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var title in new[]
                 {
                     JsonUtil.String(entry, "englishTitle"),
                     JsonUtil.String(entry, "title"),
                     JsonUtil.String(entry, "romajiTitle")
                 })
        {
            if (!string.IsNullOrWhiteSpace(title) && seen.Add(title.Trim()))
            {
                yield return title.Trim();
            }
        }

        foreach (var synonym in (entry["synonyms"] as JsonArray ?? []).Select(item => item?.GetValue<string>()).Where(value => !string.IsNullOrWhiteSpace(value)))
        {
            if (seen.Count >= 5)
            {
                yield break;
            }
            if (seen.Add(synonym!.Trim()))
            {
                yield return synonym.Trim();
            }
        }
    }

    private static string NormalizeComparableTitle(string value)
    {
        var normalized = Regex.Replace(value, @"\\"",?availableEpisodes""?", "", RegexOptions.IgnoreCase);
        normalized = Regex.Replace(normalized, "availableEpisodes", "", RegexOptions.IgnoreCase);
        normalized = Regex.Replace(normalized, @"\b(\d+)(st|nd|rd|th)\s+season\b", "season $1", RegexOptions.IgnoreCase);
        normalized = Regex.Replace(normalized, @"[^a-zA-Z0-9\s]", " ");
        normalized = Regex.Replace(normalized, @"\bseason\s+(\d+)\b", "s$1", RegexOptions.IgnoreCase);
        normalized = Regex.Replace(normalized, @"\s+", " ");
        return normalized.Trim().ToLowerInvariant();
    }

    private static int? TitleSeasonNumber(string value)
    {
        var normalized = Regex.Replace(value, @"\b(\d+)(st|nd|rd|th)\s+season\b", "season $1", RegexOptions.IgnoreCase).ToLowerInvariant();
        var match = Regex.Match(normalized, @"\bseason\s*(\d+)\b|\bs(\d+)\b|\b(\d+)(st|nd|rd|th)\b");
        if (!match.Success)
        {
            var romanMatch = Regex.Match(normalized, @"\b(ii|iii|iv|v|vi|vii|viii|ix|x)\b", RegexOptions.IgnoreCase);
            if (romanMatch.Success)
            {
                return RomanSeasonNumber(romanMatch.Groups[1].Value);
            }
            var trailingMatch = Regex.Match(normalized, @"\b(\d+)$");
            return trailingMatch.Success ? int.Parse(trailingMatch.Groups[1].Value) : null;
        }
        if (match.Groups[1].Success)
        {
            return int.Parse(match.Groups[1].Value);
        }
        if (match.Groups[2].Success || match.Groups[3].Success)
        {
            return int.Parse(match.Groups[2].Success ? match.Groups[2].Value : match.Groups[3].Value);
        }
        return null;
    }

    private static int? RomanSeasonNumber(string value)
    {
        return value.ToLowerInvariant() switch
        {
            "ii" => 2,
            "iii" => 3,
            "iv" => 4,
            "v" => 5,
            "vi" => 6,
            "vii" => 7,
            "viii" => 8,
            "ix" => 9,
            "x" => 10,
            _ => null
        };
    }

    private static bool IsSeriesFormat(string? format)
    {
        return string.Equals(format, "TV", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(format, "TV_SHORT", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsStandaloneVariant(string value)
    {
        return Regex.IsMatch(value, @"\b(movie|ova|ona|specials?|recap|mini|chara|memory|break\s*time)\b", RegexOptions.IgnoreCase);
    }

    private static bool HasForbiddenVariantMismatch(JsonObject entry, string queryTitle, string candidateTitle)
    {
        if (!IsSeriesFormat(JsonUtil.String(entry, "format")) || IsStandaloneVariant(queryTitle))
        {
            return false;
        }

        var entryTitles = AvailabilityTitles(entry).ToArray();
        return IsStandaloneVariant(candidateTitle) && !entryTitles.Any(IsStandaloneVariant);
    }

    private static bool HasExtraCandidateQualifier(string queryTitle, string candidateTitle)
    {
        var queryTokens = NormalizeComparableTitle(queryTitle)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var candidateTokens = NormalizeComparableTitle(candidateTitle)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(IsDistinctiveToken)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

        var extra = candidateTokens.Where(token => !queryTokens.Contains(token)).ToArray();
        return extra.Any(token => token is "gou" or "sotsu" or "kai" or "outbreak" or "memories" or "final" or "illegals");
    }

    private static bool IsShortNonExactQuery(string queryTitle, string candidateTitle)
    {
        var query = NormalizeComparableTitle(queryTitle);
        var candidate = NormalizeComparableTitle(candidateTitle);
        return query.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length <= 2 && query != candidate;
    }

    private static bool HasDistinctiveTailMatch(IEnumerable<string> entryTitles, string candidateTitle)
    {
        var candidateTokens = NormalizeComparableTitle(candidateTitle)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var entryTitle in entryTitles)
        {
            var tailTokens = DistinctiveTailTokens(entryTitle);
            if (tailTokens.Length >= 2 && tailTokens.Count(candidateTokens.Contains) >= 2)
            {
                return true;
            }
        }
        return false;
    }

    private static bool HasDistinctiveTail(string title) => DistinctiveTailTokens(title).Length >= 2;

    private static bool DistinctiveTailMatches(string title, string candidateTitle)
    {
        var tailTokens = DistinctiveTailTokens(title);
        if (tailTokens.Length < 2)
        {
            return true;
        }

        var candidateTokens = NormalizeComparableTitle(candidateTitle)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        return tailTokens.Count(candidateTokens.Contains) >= 2;
    }

    private static string[] DistinctiveTailTokens(string title)
    {
        if (!Regex.IsMatch(title, @"[:\-–—]"))
        {
            return [];
        }

        var tail = Regex.Split(title, @"[:\-–—]")
            .LastOrDefault(part => !string.IsNullOrWhiteSpace(part)) ?? "";
        return NormalizeComparableTitle(tail)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(IsDistinctiveToken)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static bool IsDistinctiveToken(string token)
    {
        return token.Length > 2 && !new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "the", "and", "for", "with", "that", "this", "from", "season", "part", "episode",
            "no", "wo", "wa", "ga", "ni", "de", "to", "kara", "naru", "tame"
        }.Contains(token);
    }

    private static string CleanProviderTitle(string value)
    {
        var cleaned = Regex.Replace(value, @"\\"",?availableEpisodes""?", "", RegexOptions.IgnoreCase);
        cleaned = Regex.Replace(cleaned, @""",?availableEpisodes""?", "", RegexOptions.IgnoreCase);
        cleaned = Regex.Replace(cleaned, @"\s+", " ");
        return cleaned.Trim();
    }

    private static double TitleScore(string a, string b)
    {
        var left = NormalizeComparableTitle(a);
        var right = NormalizeComparableTitle(b);
        if (left.Length == 0 || right.Length == 0)
        {
            return 0;
        }
        if (left == right)
        {
            return 1;
        }
        var compactLeft = left.Replace(" ", "");
        var compactRight = right.Replace(" ", "");
        if (compactLeft == compactRight)
        {
            return 0.98;
        }
        if (compactLeft.Contains(compactRight) || compactRight.Contains(compactLeft))
        {
            return (double)Math.Min(compactLeft.Length, compactRight.Length) / Math.Max(compactLeft.Length, compactRight.Length);
        }
        if (left.Contains(right) || right.Contains(left))
        {
            return (double)Math.Min(left.Length, right.Length) / Math.Max(left.Length, right.Length);
        }

        var leftTokens = left.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var rightTokens = right.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToHashSet();
        var intersection = leftTokens.Count(token => rightTokens.Contains(token));
        var union = leftTokens.Union(rightTokens).Count();
        return union == 0 ? 0 : (double)intersection / union;
    }
}
