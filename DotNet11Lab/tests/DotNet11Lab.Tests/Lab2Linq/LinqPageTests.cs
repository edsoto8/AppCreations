using Bunit;
using DotNet11Lab.Core;
using DotNet11Lab.Core.Source;
using DotNet11Lab.Tests.Infrastructure;
using DotNet11Lab.Web.Components.Pages.Labs.Linq;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab2Linq;

public class LinqPageTests : BunitContext
{
    public LinqPageTests() => Services.AddSingleton(new SourceCatalog([typeof(LabServiceRegistration).Assembly]));

    [Fact]
    public void Reconciliation_tool_reconciles_the_sample_csv_and_filters_by_category()
    {
        var cut = Render<ReconciliationTool>();

        cut.FindAll(".tab").First(t => t.TextContent.Contains("CSV", StringComparison.Ordinal)).Click();
        cut.Find("#reconcile .demo-actions .btn-primary").Click();

        cut.WaitForAssertion(() => Assert.Contains("agree row for row", cut.Markup, StringComparison.Ordinal), TimeSpan.FromSeconds(10));
        Assert.Equal(8, cut.FindAll("#reconcile tbody tr").Count);   // 4 matched + 1 mismatch + 1 missing in bank + 2 missing in ledger

        cut.FindAll("#reconcile .tab").First(t => t.TextContent.StartsWith("Amount mismatch", StringComparison.Ordinal)).Click();
        var row = Assert.Single(cut.FindAll("#reconcile tbody tr"));
        Assert.Contains("INV-1003", row.TextContent, StringComparison.Ordinal);
        Assert.Contains("+27.00", row.TextContent, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Page_html_contains_the_embedded_linq_sources()
    {
        await using var factory = new LabWebFactory();
        using var client = factory.CreateClient();

        var html = await client.GetStringAsync("/labs/linq", Xunit.TestContext.Current.CancellationToken);

        Assert.Contains("FullJoin", html, StringComparison.Ordinal);
        Assert.Contains("DefaultIfEmpty", html, StringComparison.Ordinal);
    }
}
