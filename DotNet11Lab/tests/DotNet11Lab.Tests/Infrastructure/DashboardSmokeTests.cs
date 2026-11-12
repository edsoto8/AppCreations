using System.Net;
using DotNet11Lab.Core.Catalog;

namespace DotNet11Lab.Tests.Infrastructure;

public class DashboardSmokeTests(LabWebFactory factory) : IClassFixture<LabWebFactory>
{
    public static TheoryData<string> Routes()
    {
        var data = new TheoryData<string> { "/", "/features" };
        foreach (var lab in LabCatalog.Labs) data.Add(lab.Route);
        return data;
    }

    [Theory]
    [MemberData(nameof(Routes))]
    public async Task Page_renders_successfully(string route)
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(route, TestContext.Current.CancellationToken);
        var html = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("DotNet 11 Lab", html, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Unknown_route_returns_404()
    {
        using var client = factory.CreateClient();
        using var response = await client.GetAsync("/does-not-exist", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
