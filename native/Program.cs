namespace AniListManagerPortable;

internal static class Program
{
    [STAThread]
    private static async Task Main()
    {
        using var singleInstance = new Mutex(true, @"Local\AniListManagerPortable.SingleInstance", out var isFirstInstance);
        if (!isFirstInstance)
        {
            TrayApp.OpenApp();
            return;
        }

        try
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
            var offline = new OfflineService(paths, aniList, availability, http);
            var updates = new UpdateService(http, paths);
            var server = new ApiServer(tokens, watchNow, aniList, availability, offline, updates, paths);
            using var tray = new TrayApp(server, tokens);
            tray.Run();
            await server.StopAsync();
        }
        finally
        {
            singleInstance.ReleaseMutex();
        }
    }
}
