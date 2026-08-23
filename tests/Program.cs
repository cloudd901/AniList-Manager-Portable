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
    await TestDirectProviderIsPrimary(paths);
    await TestAdultDirectSearchIsEnabled(paths);
    await TestDirectFailureFallsBackToHosted(paths);
    await TestConcurrentFailuresUseOneHostedProbe(paths);
    await TestHostedCircuitCooldown(paths);
    await TestCancellationDoesNotPoisonProviderState(paths);
    await TestDirectRateLimitCircuit(paths);
    await TestManualRateLimitWaitsAndRetries(paths);
    TestAutomaticBatchOutcomes();
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
    using var http = new HttpClient(new ScriptedAvailabilityHandler
    {
        DirectResponder = (title, _, _) => Task.FromResult(ScriptedAvailabilityHandler.DirectSuccess(title, 3, 0))
    });
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

async Task TestDirectProviderIsPrimary(AppPaths paths)
{
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (title, _, _) => Task.FromResult(ScriptedAvailabilityHandler.DirectSuccess(title, 12, 4)),
        HostedResponder = (title, _, _) => Task.FromResult(ScriptedAvailabilityHandler.HostedSuccess(title, 12, 4))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths);
    var result = await service.ResolveAsync(Entry(8001, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), CancellationToken.None, true);

    Expect(JsonUtil.Int(result, "subEpisodes") == 12, "direct provider success should return availability");
    Expect(handler.DirectCalls == 1, "direct provider should be called first");
    Expect(handler.HostedCalls == 0, "direct success should never call the hosted proxy");
    Expect(handler.LastDirectAllowAdult == false, "direct provider should not broaden ordinary title searches to adult results");
}

async Task TestAdultDirectSearchIsEnabled(AppPaths paths)
{
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (title, _, _) => Task.FromResult(ScriptedAvailabilityHandler.DirectSuccess(title, 1, 0))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths);
    var entry = Entry(8003, "CURRENT", "RELEASING", 1, EndDate(2026, 12, 1));
    entry["isAdult"] = true;
    var result = await service.ResolveAsync(entry, true, new JsonObject(), CancellationToken.None, true);

    Expect(JsonUtil.Int(result, "subEpisodes") == 1, "adult direct provider search should return availability");
    Expect(handler.LastDirectAllowAdult == true, "adult list entries should enable adult direct-provider results");
}

async Task TestDirectFailureFallsBackToHosted(AppPaths paths)
{
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (_, _, _) => Task.FromResult(ScriptedAvailabilityHandler.Failure(HttpStatusCode.ServiceUnavailable)),
        HostedResponder = (title, _, _) => Task.FromResult(ScriptedAvailabilityHandler.HostedSuccess(title, 9, 2))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths);
    var result = await service.ResolveAsync(Entry(8002, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), CancellationToken.None, true);

    Expect(JsonUtil.Int(result, "subEpisodes") == 9, "hosted fallback should return availability after direct failure");
    Expect(handler.DirectCalls == 1 && handler.HostedCalls == 1, "direct failure should make exactly one hosted fallback request");
}

async Task TestConcurrentFailuresUseOneHostedProbe(AppPaths paths)
{
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (_, _, _) => Task.FromResult(ScriptedAvailabilityHandler.Failure(HttpStatusCode.ServiceUnavailable)),
        HostedResponder = (_, _, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("proxy DNS failure"))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths);
    var timer = Stopwatch.StartNew();
    var tasks = Enumerable.Range(0, 6).Select(async index =>
    {
        try
        {
            await service.ResolveAsync(Entry(8100 + index, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), CancellationToken.None, true);
            return false;
        }
        catch (AvailabilityProviderException)
        {
            return true;
        }
    });
    var failed = await Task.WhenAll(tasks);

    Expect(failed.All(value => value), "all six scripted provider failures should be reported");
    Expect(handler.DirectCalls == 6, "all concurrent lookups should try the direct provider");
    Expect(handler.HostedCalls == 1, "six concurrent failures should perform only one hosted health probe");
    Expect(timer.Elapsed < TimeSpan.FromSeconds(3), "concurrent provider failures should not incur shared exponential delay");
}

async Task TestHostedCircuitCooldown(AppPaths paths)
{
    var clock = DateTimeOffset.Parse("2026-08-21T12:00:00Z");
    var hostedAvailable = false;
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (_, _, _) => Task.FromResult(ScriptedAvailabilityHandler.Failure(HttpStatusCode.ServiceUnavailable)),
        HostedResponder = (title, _, _) => hostedAvailable
            ? Task.FromResult(ScriptedAvailabilityHandler.HostedSuccess(title, 7, 1))
            : Task.FromException<HttpResponseMessage>(new HttpRequestException("proxy unavailable"))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths, () => clock);

    await ExpectProviderFailure(service, Entry(8201, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)));
    await ExpectProviderFailure(service, Entry(8202, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)));
    Expect(handler.HostedCalls == 1, "open hosted circuit should skip further proxy requests");

    clock = clock.AddMinutes(5).AddSeconds(1);
    hostedAvailable = true;
    var result = await service.ResolveAsync(Entry(8203, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), CancellationToken.None, true);
    Expect(JsonUtil.Int(result, "subEpisodes") == 7, "hosted proxy should be probed again after its cooldown expires");
    Expect(handler.HostedCalls == 2, "expired hosted circuit should allow exactly one new probe");
}

async Task TestCancellationDoesNotPoisonProviderState(AppPaths paths)
{
    var delayDirect = true;
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = async (title, _, token) =>
        {
            if (delayDirect)
            {
                await Task.Delay(TimeSpan.FromSeconds(10), token);
            }
            return ScriptedAvailabilityHandler.DirectSuccess(title, 8, 3);
        }
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths);
    using (var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100)))
    {
        try
        {
            await service.ResolveAsync(Entry(8301, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), cancellation.Token, true);
            failures.Add("cancelled direct request should not complete successfully");
        }
        catch (OperationCanceledException)
        {
        }
    }

    delayDirect = false;
    var result = await service.ResolveAsync(Entry(8302, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), CancellationToken.None, true);
    Expect(JsonUtil.Int(result, "subEpisodes") == 8, "provider should remain usable after caller cancellation");
    Expect(handler.DirectCalls == 2 && handler.HostedCalls == 0, "cancellation should not open or reroute provider circuits");
}

async Task TestDirectRateLimitCircuit(AppPaths paths)
{
    var clock = DateTimeOffset.Parse("2026-08-21T12:00:00Z");
    var directAvailable = false;
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (title, _, _) => Task.FromResult(directAvailable
            ? ScriptedAvailabilityHandler.DirectSuccess(title, 6, 2)
            : ScriptedAvailabilityHandler.GraphQlRateLimited(45)),
        HostedResponder = (_, _, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("proxy unavailable"))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths, () => clock);

    await ExpectProviderFailure(service, Entry(8401, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), automatic: true);
    await ExpectProviderFailure(service, Entry(8402, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), automatic: true);
    Expect(handler.DirectCalls == 1, "GraphQL rate-limit errors should open the direct circuit and skip the next automatic request");

    clock = clock.AddSeconds(46);
    directAvailable = true;
    var result = await service.ResolveAsync(Entry(8403, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)), true, new JsonObject(), CancellationToken.None, true);
    Expect(JsonUtil.Int(result, "subEpisodes") == 6, "direct provider should resume after Retry-After expires");
    Expect(handler.DirectCalls == 2, "expired direct rate-limit circuit should allow another request");
}

async Task TestManualRateLimitWaitsAndRetries(AppPaths paths)
{
    var handler = new ScriptedAvailabilityHandler
    {
        DirectResponder = (title, call, _) => Task.FromResult(call == 1
            ? ScriptedAvailabilityHandler.GraphQlRateLimited(0.05)
            : ScriptedAvailabilityHandler.DirectSuccess(title, 5, 2)),
        HostedResponder = (_, _, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("proxy unavailable"))
    };
    using var http = new HttpClient(handler);
    var service = new AvailabilityService(http, paths);
    var timer = Stopwatch.StartNew();
    var result = await service.ResolveAsync(
        Entry(8450, "CURRENT", "RELEASING", 12, EndDate(2026, 12, 1)),
        true,
        new JsonObject(),
        CancellationToken.None,
        force: true,
        automatic: false);

    Expect(JsonUtil.Int(result, "subEpisodes") == 5, "manual lookup should retry the direct provider after a rate-limit cooldown");
    Expect(handler.DirectCalls == 2 && handler.HostedCalls == 1, "manual rate limit should try the fallback once, then retry direct once");
    Expect(timer.Elapsed < TimeSpan.FromSeconds(2), "scripted manual rate-limit retry should complete after its short Retry-After delay");
}

void TestAutomaticBatchOutcomes()
{
    var complete = ApiServer.ClassifyAutomaticBatchOutcome(true, 0, 6, false, false);
    Expect(!complete.StopAutomaticQueue && complete.DeferredReason is null, "fully successful automatic wave should continue without a deferred reason");

    var isolated = ApiServer.ClassifyAutomaticBatchOutcome(true, 1, 5, false, false);
    Expect(!isolated.StopAutomaticQueue && isolated.DeferredReason == "partial_failure", "isolated lookup failure should continue the automatic queue");

    var outage = ApiServer.ClassifyAutomaticBatchOutcome(true, 6, 0, false, false);
    Expect(outage.StopAutomaticQueue && outage.DeferredReason == "provider_unavailable", "zero-success wave should stop as a provider-wide outage");

    var limited = ApiServer.ClassifyAutomaticBatchOutcome(true, 2, 4, true, false);
    Expect(limited.StopAutomaticQueue && limited.DeferredReason == "rate_limited", "rate limiting should stop the automatic queue");

    var timeout = ApiServer.ClassifyAutomaticBatchOutcome(true, 3, 3, false, true);
    Expect(timeout.StopAutomaticQueue && timeout.DeferredReason == "timeout", "batch deadline should stop the automatic queue");

    var manual = ApiServer.ClassifyAutomaticBatchOutcome(false, 2, 4, false, false);
    Expect(!manual.StopAutomaticQueue && manual.DeferredReason is null, "manual batches should not use automatic stop policy");

    var stale = Cached(8501, 12, 8, 4, "high", DateTimeOffset.UtcNow.AddDays(-2), false);
    Expect(ReferenceEquals(ApiServer.AvailabilityFailureFallback(stale), stale), "provider lookup failure should retain a stale cached value");
    Expect(ApiServer.AvailabilityFailureFallback(null) is null, "provider lookup failure without cache should remain missing rather than create an error badge");
}

async Task ExpectProviderFailure(AvailabilityService service, JsonObject entry, bool automatic = false)
{
    try
    {
        await service.ResolveAsync(entry, true, new JsonObject(), CancellationToken.None, force: true, automatic: automatic);
        failures.Add($"scripted provider request for {JsonUtil.Int(entry, "mediaId")} should fail");
    }
    catch (AvailabilityProviderException)
    {
    }
}

JsonObject Entry(int mediaId, string listStatus, string mediaStatus, int total, JsonObject? endDate) => new()
{
    ["mediaId"] = mediaId,
    ["malId"] = mediaId,
    ["status"] = listStatus,
    ["mediaStatus"] = mediaStatus,
    ["format"] = "TV",
    ["isAdult"] = false,
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

sealed class ScriptedAvailabilityHandler : HttpMessageHandler
{
    public Func<string, int, CancellationToken, Task<HttpResponseMessage>> DirectResponder { get; init; } =
        (_, _, _) => Task.FromResult(Failure(HttpStatusCode.ServiceUnavailable));
    public Func<string, int, CancellationToken, Task<HttpResponseMessage>> HostedResponder { get; init; } =
        (_, _, _) => Task.FromResult(Failure(HttpStatusCode.ServiceUnavailable));
    public int DirectCalls;
    public int HostedCalls;
    public bool? LastDirectAllowAdult;

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri?.Host.Equals("api.allanime.day", StringComparison.OrdinalIgnoreCase) == true)
        {
            var call = Interlocked.Increment(ref DirectCalls);
            var body = await request.Content!.ReadAsStringAsync(cancellationToken);
            var search = JsonNode.Parse(body)?["variables"]?["search"] as JsonObject;
            var title = JsonUtil.String(search, "query") ?? "Test";
            LastDirectAllowAdult = JsonUtil.Bool(search, "allowAdult");
            return await DirectResponder(title, call, cancellationToken);
        }

        var hostedCall = Interlocked.Increment(ref HostedCalls);
        var rawQuery = request.RequestUri?.Query.TrimStart('?') ?? "";
        var titleQuery = rawQuery.StartsWith("query=", StringComparison.OrdinalIgnoreCase) ? rawQuery[6..] : rawQuery;
        return await HostedResponder(Uri.UnescapeDataString(titleQuery), hostedCall, cancellationToken);
    }

    public static HttpResponseMessage DirectSuccess(string title, int sub, int dub) => Json(HttpStatusCode.OK, new JsonObject
    {
        ["data"] = new JsonObject
        {
            ["shows"] = new JsonObject
            {
                ["edges"] = new JsonArray((JsonNode?)new JsonObject
                {
                    ["_id"] = $"direct-{title}",
                    ["name"] = title,
                    ["availableEpisodes"] = new JsonObject { ["sub"] = sub, ["dub"] = dub }
                })
            }
        }
    }.ToJsonString());

    public static HttpResponseMessage HostedSuccess(string title, int sub, int dub) => Json(HttpStatusCode.OK, new JsonArray((JsonNode?)new JsonObject
    {
        ["id"] = $"hosted-{title}",
        ["title"] = title,
        ["episodes_sub"] = sub,
        ["episodes_dub"] = dub
    }).ToJsonString());

    public static HttpResponseMessage Failure(HttpStatusCode statusCode) => Json(statusCode, "{}");

    public static HttpResponseMessage RateLimited(TimeSpan retryAfter)
    {
        var response = Failure(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter = new System.Net.Http.Headers.RetryConditionHeaderValue(retryAfter);
        return response;
    }

    public static HttpResponseMessage GraphQlRateLimited(double retryAfterSeconds) => Json(HttpStatusCode.OK, new JsonObject
    {
        ["errors"] = new JsonArray((JsonNode?)new JsonObject
        {
            ["message"] = $"Too many requests, please try again in {retryAfterSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture)} seconds."
        })
    }.ToJsonString());

    private static HttpResponseMessage Json(HttpStatusCode statusCode, string body) => new(statusCode)
    {
        Content = new StringContent(body)
    };
}
