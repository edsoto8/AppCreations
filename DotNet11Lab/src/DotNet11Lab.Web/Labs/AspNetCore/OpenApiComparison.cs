using System.Text.Json;

namespace DotNet11Lab.Web.Labs.AspNetCore;

/// <summary>A line of a document, flagged when it is worth highlighting.</summary>
public sealed record DocumentLine(int Number, string Text, bool Highlight);

/// <summary>A line that differs between the 3.2 and the 3.1 document.</summary>
public sealed record DocumentDifference(int Line, string V32, string V31);

/// <summary>Facts read from an OpenAPI document (parsed, not assumed).</summary>
public sealed record OpenApiFacts(string Version, int Paths, int Schemas, IReadOnlyList<string> UnionSchemas, int SizeBytes);

public static class OpenApiComparison
{
    private static readonly string[] Markers = ["\"openapi\"", "\"anyOf\"", "\"itemSchema\"", "\"x-oai-itemSchema\""];

    public static IReadOnlyList<DocumentLine> Lines(string json) =>
        json.Replace("\r\n", "\n").Split('\n')
            .Select((text, i) => new DocumentLine(i + 1, text, Markers.Any(m => text.Contains(m, StringComparison.Ordinal))))
            .ToArray();

    /// <summary>Line-by-line differences. Both documents come from the same API, so their lines align.</summary>
    public static IReadOnlyList<DocumentDifference> Differences(string v32, string v31)
    {
        var a = v32.Replace("\r\n", "\n").Split('\n');
        var b = v31.Replace("\r\n", "\n").Split('\n');
        var result = new List<DocumentDifference>();
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var left = i < a.Length ? a[i] : "";
            var right = i < b.Length ? b[i] : "";
            if (!string.Equals(left, right, StringComparison.Ordinal)) result.Add(new DocumentDifference(i + 1, left.Trim(), right.Trim()));
        }
        return result;
    }

    public static OpenApiFacts Facts(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        var schemas = root.TryGetProperty("components", out var c) && c.TryGetProperty("schemas", out var s) ? s : default;
        var unions = schemas.ValueKind == JsonValueKind.Object
            ? schemas.EnumerateObject().Where(p => p.Value.TryGetProperty("anyOf", out _)).Select(p => p.Name).ToArray()
            : [];
        return new OpenApiFacts(
            root.GetProperty("openapi").GetString() ?? "?",
            root.TryGetProperty("paths", out var paths) ? paths.EnumerateObject().Count() : 0,
            schemas.ValueKind == JsonValueKind.Object ? schemas.EnumerateObject().Count() : 0,
            unions,
            System.Text.Encoding.UTF8.GetByteCount(json));
    }
}
