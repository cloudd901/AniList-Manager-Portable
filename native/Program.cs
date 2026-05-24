namespace AniListManagerPortable;

internal static class Program
{
    [STAThread]
    private static async Task Main()
    {
        using var http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(30)
        };
        var paths = new AppPaths();
        var tokens = new TokenStore(paths);
        var watchNow = new WatchNowStore(paths);
        var aniList = new AniListClient(http, tokens);
        var availability = new AvailabilityService(http, paths);
        var server = new ApiServer(tokens, watchNow, aniList, availability, paths);
        using var tray = new TrayApp(server, tokens);
        tray.Run();
        await server.StopAsync();
    }
}
