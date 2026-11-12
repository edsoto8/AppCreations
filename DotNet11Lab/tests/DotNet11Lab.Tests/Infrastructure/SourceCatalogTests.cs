using DotNet11Lab.Core;
using DotNet11Lab.Core.Source;

namespace DotNet11Lab.Tests.Infrastructure;

public class SourceCatalogTests
{
    [Fact]
    public void Parse_extracts_dedented_snippet_without_markers()
    {
        const string text = "class C\n{\n    // <snippet:Demo>\n    void M()\n    {\n    }\n    // </snippet:Demo>\n}";

        var snippet = Assert.Single(SourceCatalog.Parse("C.cs", text));

        Assert.Equal("Demo", snippet.Id);
        Assert.Equal("void M()\n{\n}", snippet.Code);
    }

    [Fact]
    public void Parse_supports_nested_snippets()
    {
        const string text = "// <snippet:Outer>\na\n// <snippet:Inner>\nb\n// </snippet:Inner>\n// </snippet:Outer>";

        var snippets = SourceCatalog.Parse("C.cs", text).ToDictionary(s => s.Id);

        Assert.Equal("b", snippets["Inner"].Code);
        Assert.Equal("a\nb", snippets["Outer"].Code);
    }

    [Fact]
    public void Parse_rejects_unclosed_snippet()
    {
        Assert.Throws<InvalidOperationException>(() => SourceCatalog.Parse("C.cs", "// <snippet:Open>\nx").ToList());
    }

    [Fact]
    public void Embedded_sources_of_core_assembly_are_discoverable()
    {
        var catalog = new SourceCatalog([typeof(LabServiceRegistration).Assembly]);

        Assert.Contains(catalog.Files, f => f.EndsWith("Source/SourceCatalog.cs", StringComparison.Ordinal));
    }
}
