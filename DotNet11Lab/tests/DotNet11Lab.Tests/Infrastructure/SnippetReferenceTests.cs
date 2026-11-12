using System.Text.RegularExpressions;
using DotNet11Lab.Core.Source;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Infrastructure;

/// <summary>Guards the "code shown is code that runs" rule: every snippet id referenced from Razor must exist.</summary>
public partial class SnippetReferenceTests(LabWebFactory factory) : IClassFixture<LabWebFactory>
{
    [GeneratedRegex("\\b(?:Snippet|OldSnippet|NewSnippet)=\"([A-Za-z0-9_.\\-]+)\"")]
    private static partial Regex SnippetAttribute();

    [Fact]
    public void Every_snippet_referenced_by_a_razor_page_exists()
    {
        var catalog = factory.Services.GetRequiredService<SourceCatalog>();
        var webDir = Path.Combine(RepoRoot(), "src", "DotNet11Lab.Web");

        var missing = Directory.EnumerateFiles(webDir, "*.razor", SearchOption.AllDirectories)
            .SelectMany(file => SnippetAttribute().Matches(File.ReadAllText(file))
                .Select(m => (File: Path.GetFileName(file), Id: m.Groups[1].Value)))
            .Where(r => !catalog.TryGet(r.Id, out _))
            .ToList();

        Assert.True(missing.Count == 0, "Missing snippets: " + string.Join(", ", missing.Select(m => $"{m.File}:{m.Id}")));
    }

    internal static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "DotNet11Lab.slnx"))) dir = dir.Parent;
        return dir?.FullName ?? throw new DirectoryNotFoundException("Could not locate DotNet11Lab.slnx above the test output folder.");
    }
}
