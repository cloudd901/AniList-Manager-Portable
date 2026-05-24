using AniListManagerPortable.Generated;

namespace AniListManagerPortable;

internal static class WebAssetServer
{
    public static WebAsset Resolve(string requestPath)
    {
        var path = Uri.UnescapeDataString(requestPath.TrimStart('/'));
        if (string.IsNullOrWhiteSpace(path))
        {
            path = "index.html";
        }

        if (WebAssets.Assets.TryGetValue(path, out var asset))
        {
            return asset;
        }

        return WebAssets.Assets.TryGetValue("index.html", out var index)
            ? index
            : new WebAsset("text/plain; charset=utf-8", "Missing embedded web assets."u8.ToArray());
    }
}
