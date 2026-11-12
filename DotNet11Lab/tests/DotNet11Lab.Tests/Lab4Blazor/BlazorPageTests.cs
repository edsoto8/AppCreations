using System.Net;
using System.Text.RegularExpressions;
using DotNet11Lab.Core.Labs.Blazor;
using DotNet11Lab.Core.Labs.Blazor.Components;
using DotNet11Lab.Tests.Infrastructure;
using DotNet11Lab.Web.Labs.Blazor;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab4Blazor;

public partial class BlazorPageTests(LabWebFactory factory) : IClassFixture<LabWebFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<string> GetHtmlAsync(string url)
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync(url, Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadAsStringAsync(Ct);
    }

    [GeneratedRegex("""<a class="go-next" href="([^"]+)" """)]
    private static partial Regex NextLink();

    [Fact]
    public async Task Static_QuickGrid_pages_and_sorts_from_the_query_string()
    {
        var html = await GetHtmlAsync("/labs/blazor/quickgrid-static?page=3&sort=Amount&direction=desc");
        var data = factory.Services.GetRequiredService<TransactionDataset>();

        // Page 3 of 20 rows, sorted by amount descending: rows 41..60 of that ordering.
        var expectedIds = data.Items.OrderByDescending(t => t.Amount).Skip(40).Take(20).Select(t => t.Id).ToArray();
        var first = Regex.Match(html, $@">\s*{expectedIds[0]}\s*</td>");
        var last = Regex.Match(html, $@">\s*{expectedIds[^1]}\s*</td>");
        Assert.True(first.Success && last.Success, "Expected rows of page 3 are missing.");
        Assert.True(first.Index < last.Index);

        // Headers and pager are links in .NET 11, so they work without a circuit.
        Assert.Contains("class=\"col-title\"", html, StringComparison.Ordinal);
        var next = WebUtility.HtmlDecode(NextLink().Match(html).Groups[1].Value);
        Assert.Contains("page=4", next, StringComparison.Ordinal);
        Assert.Contains("sort=Amount", next, StringComparison.Ordinal);
        Assert.Contains("direction=desc", next, StringComparison.Ordinal);
        Assert.DoesNotContain("_framework/blazor.web.js\" autostart", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Interactive_QuickGrid_page_uses_prefixed_parameters_for_the_second_grid()
    {
        var html = WebUtility.HtmlDecode(await GetHtmlAsync("/labs/blazor/quickgrid?m_page=2"));
        Assert.Contains("m_sort=", html, StringComparison.Ordinal);
        Assert.Contains("row-clickable", html, StringComparison.Ordinal);
        Assert.Contains("Page 2 of 4", Regex.Replace(Regex.Replace(html, "<[^>]+>", ""), "\\s+", " "), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Blazor_lab_is_static_with_prerendered_interactive_islands_and_persisted_state()
    {
        var loader = factory.Services.GetRequiredService<SummaryLoader>();
        var (persistedBefore, plainBefore) = (loader.PersistedLoads, loader.PlainLoads);

        var html = await GetHtmlAsync("/labs/blazor");

        Assert.Matches("Page · RendererInfo.Name = <b[^>]*>Static</b> · IsInteractive = <b[^>]*>false</b>", html);
        Assert.Contains("Forms island", html, StringComparison.Ordinal);
        Assert.Equal(3, Regex.Matches(html, "<!--Blazor:\\{\"type\":\"server\"").Count); // three interactive islands
        Assert.Contains("Blazor-Server-Component-State:", html, StringComparison.Ordinal); // [PersistentState] payload
        // Prerendering ran each summary loader exactly once; only the plain one will load again on the circuit.
        Assert.Equal(persistedBefore + 1, loader.PersistedLoads);
        Assert.Equal(plainBefore + 1, loader.PlainLoads);
    }

    [Fact]
    public void Markup_excerpts_shown_on_the_page_match_their_razor_files()
    {
        var webDir = Path.Combine(SnippetReferenceTests.RepoRoot(), "src", "DotNet11Lab.Web");
        static string Normalize(string s) => Regex.Replace(s, "\\s+", " ").Trim();
        foreach (var excerpt in BlazorMarkup.All)
        {
            var file = File.ReadAllText(Path.Combine(webDir, excerpt.File));
            Assert.True(Normalize(file).Contains(Normalize(excerpt.Code), StringComparison.Ordinal), $"Excerpt not found in {excerpt.File}:\n{excerpt.Code}");
        }
    }
}
