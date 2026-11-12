using System.Reflection;
using DotNet11Lab.Core.Catalog;
using Microsoft.AspNetCore.Components;

namespace DotNet11Lab.Tests.Infrastructure;

public class LabCatalogTests
{
    [Fact]
    public void Labs_are_numbered_one_to_nine_with_unique_slugs()
    {
        Assert.Equal(Enumerable.Range(1, 9), LabCatalog.Labs.Select(l => l.Number));
        Assert.Equal(LabCatalog.Labs.Count, LabCatalog.Labs.Select(l => l.Slug).Distinct().Count());
    }

    [Fact]
    public void Every_feature_links_to_official_microsoft_documentation()
    {
        Assert.All(LabCatalog.Labs.SelectMany(l => l.Features), f =>
            Assert.StartsWith("https://learn.microsoft.com/", f.Docs.Url, StringComparison.Ordinal));
    }

    [Fact]
    public void Every_lab_has_a_routable_page()
    {
        var routes = typeof(Program).Assembly.GetTypes()
            .SelectMany(t => t.GetCustomAttributes<RouteAttribute>())
            .Select(r => r.Template)
            .ToHashSet();

        Assert.All(LabCatalog.Labs, lab => Assert.Contains(lab.Route, routes));
    }
}
