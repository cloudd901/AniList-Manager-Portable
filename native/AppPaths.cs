using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal sealed class AppPaths
{
    public AppPaths()
    {
        Root = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        DataDir = Path.Combine(Root, "data");
        ConfigPath = Path.Combine(DataDir, "config.json");
        AvailabilityCachePath = Path.Combine(DataDir, "availability-cache.json");
        AvailabilityOverridesPath = Path.Combine(DataDir, "availability-overrides.json");
        MalCachePath = Path.Combine(DataDir, "mal-cache.json");
        WatchNowServersPath = Path.Combine(DataDir, "watch-now-servers.json");
        OfflineDir = Path.Combine(DataDir, "offline");
        OfflineStatePath = Path.Combine(OfflineDir, "state.json");
        OfflinePackagePath = Path.Combine(OfflineDir, "package.json");
        OfflineQueuePath = Path.Combine(OfflineDir, "queue.json");
        OfflineImagesDir = Path.Combine(OfflineDir, "images");
        RuntimeDir = Path.Combine(Root, ".runtime");
        Directory.CreateDirectory(DataDir);
        Directory.CreateDirectory(OfflineDir);
        Directory.CreateDirectory(OfflineImagesDir);
        Directory.CreateDirectory(RuntimeDir);
    }

    public string Root { get; }
    public string DataDir { get; }
    public string ConfigPath { get; }
    public string AvailabilityCachePath { get; }
    public string AvailabilityOverridesPath { get; }
    public string MalCachePath { get; }
    public string WatchNowServersPath { get; }
    public string OfflineDir { get; }
    public string OfflineStatePath { get; }
    public string OfflinePackagePath { get; }
    public string OfflineQueuePath { get; }
    public string OfflineImagesDir { get; }
    public string RuntimeDir { get; }

    public string ConfigLabel => "data\\config.json";

    public static string CliConfigPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config", "anilist-cli", "config.json");

    public JsonObject ReadPortableConfig() => JsonUtil.ReadObject(ConfigPath);

    public void WritePortableConfig(JsonObject config)
    {
        Directory.CreateDirectory(DataDir);
        File.WriteAllText(ConfigPath, config.ToJsonString(JsonUtil.WriterOptions));
    }
}
