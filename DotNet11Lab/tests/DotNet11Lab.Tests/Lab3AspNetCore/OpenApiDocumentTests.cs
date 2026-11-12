using System.Text.Json;
using DotNet11Lab.Tests.Infrastructure;

namespace DotNet11Lab.Tests.Lab3AspNetCore;

public class OpenApiDocumentTests(LabWebFactory factory) : IClassFixture<LabWebFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private async Task<JsonElement> GetDocumentAsync(string name)
    {
        using var client = factory.CreateClient();
        var json = await client.GetStringAsync($"/openapi/{name}.json", Ct);
        return JsonDocument.Parse(json).RootElement;
    }

    [Fact]
    public async Task Default_document_is_OpenAPI_3_2_0()
    {
        var doc = await GetDocumentAsync("v1");
        Assert.Equal("3.2.0", doc.GetProperty("openapi").GetString());
        Assert.Equal("DotNet 11 Lab commerce API", doc.GetProperty("info").GetProperty("title").GetString());
    }

    [Fact]
    public async Task Comparison_document_is_OpenAPI_3_1()
    {
        var doc = await GetDocumentAsync("v1-3.1");
        Assert.StartsWith("3.1.", doc.GetProperty("openapi").GetString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("PaymentOutcome", new[] { "PaymentApproved", "PaymentDeclined", "PaymentRequiresAction" })]
    [InlineData("PaymentMethod", new[] { "CardPayment", "BankTransferPayment", "WalletPayment" })]
    public async Task Unions_are_described_with_anyOf_their_case_schemas(string union, string[] cases)
    {
        foreach (var name in new[] { "v1", "v1-3.1" })
        {
            var schema = (await GetDocumentAsync(name)).GetProperty("components").GetProperty("schemas").GetProperty(union);
            var refs = schema.GetProperty("anyOf").EnumerateArray().Select(s => s.GetProperty("$ref").GetString()).ToArray();
            Assert.Equal(cases.Select(c => $"#/components/schemas/{c}"), refs);
            Assert.False(schema.TryGetProperty("discriminator", out _));
        }
    }

    [Fact]
    public async Task Authorize_response_references_the_union_schema()
    {
        var doc = await GetDocumentAsync("v1");
        var schema = doc.GetProperty("paths").GetProperty("/api/payments/authorize").GetProperty("post")
            .GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("application/json").GetProperty("schema");
        Assert.Equal("#/components/schemas/PaymentOutcome", schema.GetProperty("$ref").GetString());
    }

    [Fact]
    public async Task Server_sent_events_use_itemSchema_in_3_2_and_an_extension_in_3_1()
    {
        static JsonElement Media(JsonElement doc) => doc.GetProperty("paths").GetProperty("/api/orders/{orderId}/events").GetProperty("get")
            .GetProperty("responses").GetProperty("200").GetProperty("content").GetProperty("text/event-stream");

        Assert.True(Media(await GetDocumentAsync("v1")).TryGetProperty("itemSchema", out _));
        var v31 = Media(await GetDocumentAsync("v1-3.1"));
        Assert.False(v31.TryGetProperty("itemSchema", out _));
        Assert.True(v31.TryGetProperty("x-oai-itemSchema", out _));
    }

    [Fact]
    public async Task Operations_have_tags_and_summaries()
    {
        var doc = await GetDocumentAsync("v1");
        var checkout = doc.GetProperty("paths").GetProperty("/api/checkout").GetProperty("post");
        Assert.Equal("Checkout", checkout.GetProperty("tags")[0].GetString());
        Assert.Contains("async validation", checkout.GetProperty("summary").GetString(), StringComparison.Ordinal);
        Assert.True(checkout.GetProperty("responses").TryGetProperty("409", out _));
    }
}
