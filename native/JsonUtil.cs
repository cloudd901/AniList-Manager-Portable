using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace AniListManagerPortable;

internal static class JsonUtil
{
    public static readonly JsonSerializerOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = true
    };

    public static JsonObject ReadObject(string path)
    {
        if (!File.Exists(path))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(File.ReadAllText(path)) as JsonObject ?? new JsonObject();
        }
        catch
        {
            return new JsonObject();
        }
    }

    public static string? String(JsonNode? node, string name) => node?[name]?.GetValue<string>();

    public static int? Int(JsonNode? node, string name)
    {
        var value = node?[name];
        if (value is null)
        {
            return null;
        }
        try
        {
            return value.GetValue<int>();
        }
        catch
        {
            try
            {
                return (int)value.GetValue<double>();
            }
            catch
            {
                return int.TryParse(value.ToString(), out var parsed) ? parsed : null;
            }
        }
    }

    public static long? Long(JsonNode? node, string name)
    {
        var value = node?[name];
        if (value is null)
        {
            return null;
        }
        try
        {
            return value.GetValue<long>();
        }
        catch
        {
            try
            {
                return value.GetValue<int>();
            }
            catch
            {
                return long.TryParse(value.ToString(), out var parsed) ? parsed : null;
            }
        }
    }

    public static double? Double(JsonNode? node, string name)
    {
        var value = node?[name];
        if (value is null)
        {
            return null;
        }
        try
        {
            return value.GetValue<double>();
        }
        catch
        {
            return double.TryParse(value.ToString(), out var parsed) ? parsed : null;
        }
    }

    public static bool? Bool(JsonNode? node, string name)
    {
        var value = node?[name];
        if (value is null)
        {
            return null;
        }
        try
        {
            return value.GetValue<bool>();
        }
        catch
        {
            return bool.TryParse(value.ToString(), out var parsed) ? parsed : null;
        }
    }

    public static JsonArray Array(JsonNode? node, string name) => node?[name] as JsonArray ?? [];

    public static string Error(string message, JsonNode? details = null)
    {
        var error = new JsonObject { ["error"] = message };
        if (details is not null)
        {
            error["details"] = details.DeepClone();
        }
        return error.ToJsonString(WriterOptions);
    }
}
