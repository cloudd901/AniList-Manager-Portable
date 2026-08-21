using System.Diagnostics;
using System.Net;
using System.Text.Json.Nodes;
using AniListManagerPortable;

var failures = new List<string>();
var testRoot = Path.Combine(Path.GetTempPath(), $"AniListManagerPortable.Tests-{Guid.NewGuid():N}");
Directory.CreateDirectory(testRoot);

try
{
    using var http = new HttpClient(new DelayedHandler()) { Timeout = TimeSpan.FromSeconds(5) };
    var paths = new AppPaths(testRoot);
    var service = new AvailabilityService(http, paths);

    TestFinishedCompleteAcrossListStatuses(service);
    TestIncompleteAndLowConfidenceRemainRefreshable(service);
    TestOldSubOnlyResultBecomesPermanent(service);
    TestOverrideAndUnreleasedClassification(service);
    TestManualRefreshStableBlockers(service);
    TestMixedPreflightFixture(service);
    await TestManualForceIncludesUnreleased(paths);
    await TestCancellationRemainsBounded(service);
}
catch (Exception error)
{
    failures.Add($"Unhandled test error: {error}");
}
finally
{
    if (Directory.Exists(testRoot) && testRoot.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase))
    {
        Directory.Delete(testRoot, true);
    }
}

if (failures.Count > 0)
{
    Console.Error.WriteLine("Availability tests failed:");
    foreach (var failure in failures)
    {
        Console.Error.WriteLine($" - {failure}");
    }
    return 1;
}

Console.WriteLine("Availability tests passed.");
return 0;

void TestFinishedCompleteAcrossListStatuses(AvailabilityService service)
{
    foreach (var status in new[] { "CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING" })
    {
        var mediaId = 1000 + Array.IndexOf(new[] { "CURRENT", "PLANNING", "COMPLETED", "PAUSED", "DROPPED", "REPEATING" }, status);
        var entry = Entry(mediaId, status, "FINISHED", 12, EndDate(2024, 1, 1));
        var cached = Cached(mediaId, 12, 12, 12, "high", DateTimeOffset.UtcNow.AddDays(-10), false);
        cached["preservedField"] = "keep-me";
        var cache = new JsonObject { [mediaId.ToString()] = cached };

        var prepared = service.PrepareAutomaticAvailability(entry, cache);
        Expect(!prepared.Pending, $"{status} complete result should not be pending");
        Expect(prepared.Reason == "permanent", $"{status} complete result should be permanent");
        Expect(JsonUtil.Bool(prepared.CachedResult, "cachePermanent") == true, $"{status} cachePermanent should be corrected");
        Expect(prepared.CachedResult?["cacheExpiresAt"] is null, $"{status} permanent expiry should be cleared");
        Expect(JsonUtil.String(prepared.CachedResult, "preservedField") == "keep-me", $"{status} unrelated cache fields should be preserved");
    }
}

void TestIncompleteAndLowConfidenceRemainRefreshable(AvailabilityService service)
{
    var staleAt = DateTimeOffset.UtcNow.AddDays(-2);
    var incompleteEntry = Entry(2001, "PLANNING", "FINISHED", 12, EndDate(2025, 1, 1));
    var incompleteCache = new JsonObject { ["2001"] = Cached(2001, 12, 12, 4, "high", staleAt, false) };
    var incomplete = service.PrepareAutomaticAvailability(incompleteEntry, incompleteCache);
    Expect(incomplete.Pending && incomplete.Reason == "stale", "stale incomplete result should be pending");
    Expect(incomplete.CachedResult is not null, "stale result should still be returned for display");

    var lowEntry = Entry(2002, "COMPLETED", "FINISHED", 12, EndDate(2025, 1, 1));
    var lowCache = new JsonObject { ["2002"] = Cached(2002, 12, 12, 12, "low", staleAt, true) };
    var low = service.PrepareAutomaticAvailability(lowEntry, lowCache);
    Expect(low.Pending && low.Reason == "stale", "low-confidence complete result should remain refreshable");
    Expect(JsonUtil.Bool(low.CachedResult, "cachePermanent") != true, "low-confidence cache should be demoted from permanent");

    var freshEntry = Entry(2003, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1));
    var freshCache = new JsonObject { ["2003"] = Cached(2003, 12, 6, 4, "high", DateTimeOffset.UtcNow, false) };
    var fresh = service.PrepareAutomaticAvailability(freshEntry, freshCache);
    Expect(!fresh.Pending && fresh.Reason == "fresh", "fresh incomplete result should stay cached until expiry");
}

void TestOldSubOnlyResultBecomesPermanent(AvailabilityService service)
{
    var entry = Entry(3001, "PLANNING", "FINISHED", 24, EndDate(2018, 1, 1));
    var cache = new JsonObject { ["3001"] = Cached(3001, 24, 24, 0, "high", DateTimeOffset.UtcNow.AddDays(-30), false) };
    var prepared = service.PrepareAutomaticAvailability(entry, cache);
    Expect(!prepared.Pending && prepared.Reason == "permanent", "old high-confidence sub-complete result should be permanent");
}

void TestOverrideAndUnreleasedClassification(AvailabilityService service)
{
    service.SaveOverride(4001, new JsonObject
    {
        ["totalEpisodes"] = 10,
        ["subEpisodes"] = 10,
        ["dubEpisodes"] = 2,
        ["note"] = "test"
    });
    var overridden = service.PrepareAutomaticAvailability(
        Entry(4001, "PLANNING", "NOT_YET_RELEASED", 10, null),
        new JsonObject());
    Expect(!overridden.Pending && overridden.Reason == "override", "override should take precedence over unreleased suppression");
    Expect(JsonUtil.String(overridden.CachedResult, "source") == "local-override", "override result should be returned");

    var falsePositive = Cached(4002, 12, 12, 12, "high", DateTimeOffset.UtcNow, true);
    var unreleased = service.PrepareAutomaticAvailability(
        Entry(4002, "PLANNING", "NOT_YET_RELEASED", 12, null),
        new JsonObject { ["4002"] = falsePositive });
    Expect(!unreleased.Pending && unreleased.Reason == "unreleased", "unreleased entry should be skipped");
    Expect(unreleased.CachedResult is null, "unreleased false-positive cache should not be displayed");
}

void TestMixedPreflightFixture(AvailabilityService service)
{
    var entries = new List<JsonObject>();
    var cache = new JsonObject();
    for (var index = 0; index < 50; index += 1)
    {
        var id = 5000 + index;
        entries.Add(Entry(id, index % 2 == 0 ? "PLANNING" : "CURRENT", "FINISHED", 12, EndDate(2024, 1, 1)));
        cache[id.ToString()] = Cached(id, 12, 12, 12, "high", DateTimeOffset.UtcNow.AddDays(-2), false);
    }
    entries.Add(Entry(5050, "PLANNING", "RELEASING", 12, EndDate(2026, 12, 1)));
    cache["5050"] = Cached(5050, 12, 5, 2, "high", DateTimeOffset.UtcNow, false);
    entries.Add(Entry(5051, "PLANNING", "NOT_YET_RELEASED", 12, null));
    for (var index = 0; index < 6; index += 1)
    {
        var id = 5052 + index;
        entries.Add(Entry(id, "PLANNING", "RELEASING", 12, EndDate(2026, 12, 1)));
        cache[id.ToString()] = Cached(id, 12, 5, 2, "high", DateTimeOffset.UtcNow.AddDays(-2), false);
    }
    for (var index = 0; index < 5; index += 1)
    {
        entries.Add(Entry(5058 + index, "PLANNING", "RELEASING", 12, EndDate(2026, 12, 1)));
    }

    var prepared = entries.Select(entry => service.PrepareAutomaticAvailability(entry, cache)).ToArray();
    Expect(entries.Count == 63, "mixed preflight fixture should contain 63 entries");
    Expect(prepared.Count(item => item.Pending) == 11, "only six stale and five missing entries should require remote checks");
    Expect(prepared.Count(item => item.Reason == "permanent") == 50, "50 complete finished entries should be permanent");
    Expect(prepared.Count(item => item.Reason == "fresh") == 1, "one fresh incomplete entry should be skipped");
    Expect(prepared.Count(item => item.Reason == "unreleased") == 1, "one unreleased entry should be omitted from the total");
}

void TestManualRefreshStableBlockers(AvailabilityService service)
{
    var now = DateTimeOffset.UtcNow;

    var permanentEntry = Entry(4501, "CURRENT", "FINISHED", 12, EndDate(2025, 1, 1));
    var permanentCache = new JsonObject { ["4501"] = Cached(4501, 12, 12, 12, "high", now, false) };
    Expect(
        service.GetReusableCachedResult(permanentEntry, refresh: true, permanentCache) is not null,
        "manual refresh should reuse permanent finished sub/dub-complete results");

    var completeAiringEntry = Entry(4502, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1));
    var completeAiringCache = new JsonObject { ["4502"] = Cached(4502, 12, 12, 12, "high", now, false) };
    Expect(
        service.GetReusableCachedResult(completeAiringEntry, refresh: true, completeAiringCache) is null,
        "manual refresh should recheck non-permanent sub/dub-complete results");

    var incompleteFreshEntry = Entry(4503, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1));
    var incompleteFreshCache = new JsonObject { ["4503"] = Cached(4503, 12, 8, 6, "high", now, false) };
    Expect(
        service.GetReusableCachedResult(incompleteFreshEntry, refresh: true, incompleteFreshCache) is null,
        "manual refresh should not time-gate a fresh incomplete result");

    var unreleasedEntry = Entry(4504, "PLANNING", "NOT_YET_RELEASED", 12, null);
    var unreleasedCache = new JsonObject { ["4504"] = Cached(4504, 12, 12, 12, "high", now, false) };
    Expect(
        service.GetReusableCachedResult(unreleasedEntry, refresh: true, unreleasedCache) is null,
        "manual refresh should allow a forced unreleased lookup");
}

async Task TestCancellationRemainsBounded(AvailabilityService service)
{
    var entry = Entry(7001, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1));
    using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
    var timer = Stopwatch.StartNew();
    try
    {
        await service.ResolveAsync(entry, false, new JsonObject(), timeout.Token);
        failures.Add("cancelled provider request should not complete successfully");
    }
    catch (OperationCanceledException)
    {
        Expect(timer.Elapsed < TimeSpan.FromSeconds(2), "provider cancellation should remain bounded");
    }
}

async Task TestManualForceIncludesUnreleased(AppPaths paths)
{
    using var http = new HttpClient(new SuccessfulAvailabilityHandler());
    var service = new AvailabilityService(http, paths);
    var result = await service.ResolveAsync(
        Entry(6001, "PLANNING", "NOT_YET_RELEASED", 12, null),
        true,
        new JsonObject(),
        CancellationToken.None,
        force: true);

    Expect(result is not null, "forced manual lookup should include unreleased entries");
    Expect(JsonUtil.Int(result, "subEpisodes") == 3, "forced unreleased lookup should return provider data");
}

JsonObject Entry(int mediaId, string listStatus, string mediaStatus, int total, JsonObject? endDate) => new()
{
    ["mediaId"] = mediaId,
    ["malId"] = mediaId,
    ["status"] = listStatus,
    ["mediaStatus"] = mediaStatus,
    ["format"] = "TV",
    ["title"] = $"Test {mediaId}",
    ["romajiTitle"] = $"Test {mediaId}",
    ["englishTitle"] = $"Test {mediaId}",
    ["synonyms"] = new JsonArray(),
    ["totalEpisodes"] = total,
    ["endDate"] = endDate
};

JsonObject Cached(int mediaId, int total, int sub, int dub, string confidence, DateTimeOffset checkedAt, bool permanent) => new()
{
    ["mediaId"] = mediaId,
    ["status"] = "found",
    ["totalEpisodes"] = total,
    ["subEpisodes"] = sub,
    ["dubEpisodes"] = dub,
    ["matchConfidence"] = confidence,
    ["checkedAt"] = checkedAt.ToString("O"),
    ["cachePermanent"] = permanent,
    ["cacheExpiresAt"] = permanent ? null : checkedAt.AddHours(24).ToString("O")
};

JsonObject EndDate(int year, int month, int day) => new()
{
    ["year"] = year,
    ["month"] = month,
    ["day"] = day
};

void Expect(bool condition, string message)
{
    if (!condition)
    {
        failures.Add(message);
    }
}

sealed class DelayedHandler : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
        return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
    }
}

sealed class SuccessfulAvailabilityHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("[{\"id\":\"test-6001\",\"title\":\"Test 6001\",\"episodes_sub\":3,\"episodes_dub\":0}]")
        };
        return Task.FromResult(response);
    }
}
