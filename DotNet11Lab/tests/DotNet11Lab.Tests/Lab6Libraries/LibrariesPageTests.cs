using Bunit;
using DotNet11Lab.Core;
using DotNet11Lab.Core.Source;
using DotNet11Lab.Tests.Infrastructure;
using DotNet11Lab.Web.Components.Pages.Labs.Libraries;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab6Libraries;

public class LibrariesPageTests : BunitContext
{
    public LibrariesPageTests() => Services.AddSingleton(new SourceCatalog([typeof(LabServiceRegistration).Assembly]));

    [Fact]
    public void Writable_stream_demo_shows_the_overflow_exception_for_both_approaches()
    {
        var cut = Render<StreamAdaptersSection>();

        cut.Act(c => c.Find("#streams-writable .demo-actions .btn-primary").Click());

        cut.WaitForAssertion(() => Assert.Equal(2, cut.FindAll("#streams-writable tr.row-danger").Count));
    }

    [Fact]
    public void Json_lines_demo_reports_identical_output_to_the_legacy_loop()
    {
        var cut = Render<JsonSection>();

        cut.Act(c => c.Find("#jsonl-run .demo-actions .btn-primary").Click());

        cut.WaitForAssertion(() =>
        {
            var text = cut.Find("#jsonl-run .demo-result").TextContent;
            Assert.Contains("Yes", text, StringComparison.Ordinal);
            Assert.Contains("\"id\":\"tx_110000000\"", text, StringComparison.Ordinal);
        }, TimeSpan.FromSeconds(10));
    }

    [Fact]
    public void Compression_demo_verifies_every_round_trip()
    {
        var cut = Render<CompressionSection>();
        cut.Act(c => c.Find("#z-size").Change("64"));
        cut.Act(c => c.Find("#z-it").Change("1"));

        cut.Act(c => c.Find("#zstd-compare .demo-actions .btn-primary").Click());

        cut.WaitForAssertion(() => Assert.Equal(3, cut.FindAll("#zstd-compare .badge-stable").Count), TimeSpan.FromSeconds(20));
    }

    [Fact]
    public async Task Page_html_contains_the_embedded_library_sources()
    {
        await using var factory = new LabWebFactory();
        using var client = factory.CreateClient();

        var html = await client.GetStringAsync("/labs/libraries", Xunit.TestContext.Current.CancellationToken);

        Assert.Contains("ZstandardStream", html, StringComparison.Ordinal);
        Assert.Contains("topLevelValues: true", html, StringComparison.Ordinal);
    }
}
