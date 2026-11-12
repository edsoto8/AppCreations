using Bunit;
using DotNet11Lab.Core;
using DotNet11Lab.Core.Source;
using DotNet11Lab.Tests.Infrastructure;
using DotNet11Lab.Web.Components.Pages.Labs.CSharp15;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab1CSharp15;

/// <summary>Renders the interactive sections with bUnit and drives them like a user would.</summary>
public class CSharp15PageTests : BunitContext
{
    public CSharp15PageTests()
    {
        Services.AddSingleton(new SourceCatalog([typeof(LabServiceRegistration).Assembly]));
        Services.AddSingleton(TimeProvider.System);
    }

    [Fact]
    public void Checkout_demo_shows_the_matched_union_case()
    {
        var cut = Render<UnionsSection>();

        cut.Find("#scenario").Change("1");   // Insufficient funds
        cut.Find("#union-run .demo-actions .btn-primary").Click();

        cut.WaitForAssertion(() =>
        {
            Assert.Contains("PaymentDeclined", cut.Find("#union-run .demo-result").TextContent, StringComparison.Ordinal);
            Assert.Contains("Insufficient funds", cut.Find("#union-run .demo-result").TextContent, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Json_demo_shows_plain_failure_and_classified_success()
    {
        var cut = Render<UnionsSection>();

        cut.Find("#union-json .demo-actions .btn-primary").Click();

        cut.WaitForAssertion(() =>
        {
            var rows = cut.FindAll("#union-json tbody tr");
            Assert.Equal(2, rows.Count);
            Assert.Contains("JsonException", rows[0].TextContent, StringComparison.Ordinal);
            Assert.Contains("PaymentPending", rows[1].TextContent, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Stepper_walks_an_order_to_shipped()
    {
        var cut = Render<ClosedHierarchySection>();

        foreach (var command in new[] { "AddLine", "Submit", "Pay", "Ship" })
            cut.FindAll("#closed-stepper button").First(b => b.TextContent.Trim() == command).Click();

        Assert.Contains("Shipped", cut.Find("#closed-stepper .badge").TextContent, StringComparison.Ordinal);
        Assert.Equal(4, cut.FindAll("#closed-stepper tr.row-ok").Count);
    }

    [Fact]
    public void Labeled_loop_demo_reports_identical_results()
    {
        var cut = Render<LabeledLoopsSection>();

        cut.Find("#labeled-break .demo-actions .btn-primary").Click();

        cut.WaitForAssertion(() => Assert.Contains("identical results", cut.Find("#labeled-break").TextContent, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Page_html_contains_the_embedded_csharp15_sources()
    {
        await using var factory = new LabWebFactory();
        using var client = factory.CreateClient();

        var html = await client.GetStringAsync("/labs/csharp15", Xunit.TestContext.Current.CancellationToken);

        Assert.Contains("PaymentResult", html, StringComparison.Ordinal);
        Assert.Contains("LegacyFindBin", html, StringComparison.Ordinal);
        Assert.Contains("OrderIndexers", html, StringComparison.Ordinal);
    }
}
