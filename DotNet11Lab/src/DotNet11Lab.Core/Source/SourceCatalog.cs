using System.Collections.Concurrent;
using System.Reflection;
using System.Text;

namespace DotNet11Lab.Core.Source;

/// <summary>A named excerpt of real source code compiled into one of the lab assemblies.</summary>
public sealed record SourceSnippet(string Id, string File, string Code);

/// <summary>
/// Reads the .cs files that projects with <c>EmbedLabSources=true</c> embed into themselves (see Directory.Build.props),
/// so the dashboard displays exactly the code that executes rather than a hand-copied sample.
/// Snippets are delimited by <c>// &lt;snippet:Id&gt;</c> and <c>// &lt;/snippet:Id&gt;</c> comment lines.
/// </summary>
public sealed class SourceCatalog
{
    private const string Prefix = "labsrc/";
    private readonly ConcurrentDictionary<string, SourceSnippet> _snippets = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, string> _files = new(StringComparer.Ordinal);

    public SourceCatalog(IEnumerable<Assembly> assemblies)
    {
        foreach (var assembly in assemblies.Distinct())
        {
            foreach (var name in assembly.GetManifestResourceNames().Where(n => n.StartsWith(Prefix, StringComparison.Ordinal)))
            {
                using var stream = assembly.GetManifestResourceStream(name)!;
                using var reader = new StreamReader(stream, Encoding.UTF8);
                var file = name[Prefix.Length..].Replace('\\', '/');
                var text = reader.ReadToEnd().Replace("\r\n", "\n");
                _files[file] = text;
                foreach (var snippet in Parse(file, text))
                {
                    if (!_snippets.TryAdd(snippet.Id, snippet))
                        throw new InvalidOperationException($"Duplicate snippet id '{snippet.Id}' in {file}.");
                }
            }
        }
    }

    public IReadOnlyCollection<string> Files => _files.Keys.Order().ToArray();

    public IReadOnlyCollection<string> SnippetIds => _snippets.Keys.Order().ToArray();

    public SourceSnippet Get(string id) =>
        _snippets.TryGetValue(id, out var s) ? s : throw new KeyNotFoundException($"Snippet '{id}' was not found in any embedded source.");

    public bool TryGet(string id, out SourceSnippet? snippet) => _snippets.TryGetValue(id, out snippet);

    public string GetFile(string file) =>
        _files.TryGetValue(file, out var text) ? text : throw new KeyNotFoundException($"Source file '{file}' was not embedded.");

    internal static IEnumerable<SourceSnippet> Parse(string file, string text)
    {
        var lines = text.Split('\n');
        var open = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < lines.Length; i++)
        {
            var trimmed = lines[i].Trim();
            if (TryMarker(trimmed, "// <snippet:", out var startId))
            {
                open[startId] = i + 1;
            }
            else if (TryMarker(trimmed, "// </snippet:", out var endId))
            {
                if (!open.Remove(endId, out var start))
                    throw new InvalidOperationException($"Snippet end '{endId}' without start in {file}.");
                var body = lines[start..i].Where(l => !IsMarker(l.Trim()));
                yield return new SourceSnippet(endId, file, Dedent(body));
            }
        }
        if (open.Count > 0)
            throw new InvalidOperationException($"Unclosed snippet(s) {string.Join(", ", open.Keys)} in {file}.");
    }

    private static bool IsMarker(string trimmed) =>
        trimmed.StartsWith("// <snippet:", StringComparison.Ordinal) || trimmed.StartsWith("// </snippet:", StringComparison.Ordinal);

    private static bool TryMarker(string trimmed, string prefix, out string id)
    {
        id = "";
        if (!trimmed.StartsWith(prefix, StringComparison.Ordinal) || !trimmed.EndsWith('>')) return false;
        id = trimmed[prefix.Length..^1];
        return id.Length > 0;
    }

    private static string Dedent(IEnumerable<string> lines)
    {
        var list = lines.ToList();
        var indent = list.Where(l => l.Trim().Length > 0).Select(l => l.Length - l.TrimStart().Length).DefaultIfEmpty(0).Min();
        return string.Join('\n', list.Select(l => l.Length >= indent ? l[indent..] : l.TrimStart())).Trim('\n');
    }
}
