using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using DotNet11Lab.Api.Playground;
using DotNet11Lab.Tests.Infrastructure;

namespace DotNet11Lab.Tests.Lab3AspNetCore;

/// <summary>Drives every Lab 3 endpoint through the full dashboard host (the API is mapped in-process).</summary>
public class ApiEndpointTests(LabWebFactory factory) : IClassFixture<LabWebFactory>
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static TheoryData<string> PresetIds() => new(ApiPresets.All.Select(p => p.Id));

    [Theory]
    [MemberData(nameof(PresetIds))]
    public async Task Every_playground_preset_returns_its_expected_status(string presetId)
    {
        var preset = ApiPresets.Get(presetId);
        using var response = await SendAsync(preset);
        var body = await response.Content.ReadAsStringAsync(Ct);

        Assert.True((int)response.StatusCode == preset.ExpectedStatus, $"{preset.Id}: expected {preset.ExpectedStatus}, got {(int)response.StatusCode}: {body}");
    }

    [Fact]
    public async Task Valid_checkout_is_created_priced_and_retrievable()
    {
        using var response = await SendAsync(ApiPresets.Get("checkout-valid"));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var order = await ReadJsonAsync(response);

        // Keyboard 89.00 + 2 x cable 9.99 = 108.98; GOLD20 = 21.796 -> 21.80
        Assert.Equal(108.98m, order.GetProperty("subtotal").GetDecimal());
        Assert.Equal(21.80m, order.GetProperty("discount").GetDecimal());
        Assert.Equal(87.18m, order.GetProperty("total").GetDecimal());
        Assert.Equal("Pending", order.GetProperty("status").GetString());

        using var client = factory.CreateClient();
        using var fetched = await client.GetAsync(response.Headers.Location, Ct);
        Assert.Equal(HttpStatusCode.OK, fetched.StatusCode);
    }

    [Fact]
    public async Task Sync_attribute_failures_are_reported_for_nested_objects_and_items()
    {
        var errors = await ValidationErrorsAsync(ApiPresets.Get("checkout-sync-invalid"));
        Assert.Contains("Currency", errors.Keys);
        Assert.Contains("Lines[0].Quantity", errors.Keys);
        Assert.Contains("ShipTo.Name", errors.Keys);
    }

    [Fact]
    public async Task Async_attribute_failures_are_reported_before_the_handler_runs()
    {
        var errors = await ValidationErrorsAsync(ApiPresets.Get("checkout-async-invalid"));
        Assert.Equal(["Customer 'cus_9999' does not exist or is suspended."], errors["CustomerId"]);
        Assert.Equal(["Coupon 'EXPIRED24' is unknown or expired."], errors["CouponCode"]);
        Assert.Equal(["SKU 'SKU-TOASTER' is not in the catalog."], errors["Lines[1].Sku"]);
        Assert.DoesNotContain("Lines[0].Sku", errors.Keys);
    }

    [Fact]
    public async Task Suspended_customer_fails_the_async_attribute()
    {
        var errors = await ValidationErrorsAsync(Checkout(customerId: "cus_1003"));
        Assert.Contains("CustomerId", errors.Keys);
    }

    [Fact]
    public async Task Async_cross_field_rule_from_IAsyncValidatableObject_is_reported()
    {
        var errors = await ValidationErrorsAsync(ApiPresets.Get("checkout-cross-field-invalid"));
        var message = Assert.Single(errors["CouponCode"]);
        Assert.Contains("first order", message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Tier_restricted_coupon_is_rejected_for_a_standard_customer()
    {
        var errors = await ValidationErrorsAsync(Checkout(customerId: "cus_1002", coupon: "GOLD20"));
        Assert.Contains(errors["CouponCode"], m => m.Contains("Gold tier", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Sync_IValidatableObject_rule_runs_because_ValidateAsync_delegates_to_it()
    {
        // AddValidation() only calls ValidateAsync on an IAsyncValidatableObject; CheckoutRequest yields its sync rules from it.
        var errors = await ValidationErrorsAsync(Checkout(country: "JP", express: true));
        Assert.Contains(errors["ShipTo"], m => m.Contains("Express shipping", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Manual_v10_style_endpoint_reports_the_same_errors_as_AddValidation()
    {
        var modern = await ValidationErrorsAsync(ApiPresets.Get("checkout-async-invalid"));
        var legacy = await ValidationErrorsAsync(ApiPresets.Get("checkout-v10style-invalid"));
        Assert.Equal(modern.Keys.Order(), legacy.Keys.Order());
        foreach (var key in modern.Keys) Assert.Equal(modern[key], legacy[key]);
    }

    [Fact]
    public async Task Manual_v10_style_endpoint_creates_orders_too()
    {
        var preset = ApiPresets.Get("checkout-valid") with { Path = "/api/v10style/checkout" };
        using var response = await SendAsync(preset);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Theory]
    [InlineData("payment-approved", "paymentId", new[] { "authorizationCode", "amount", "currency", "approvedAt" })]
    [InlineData("payment-declined", "declineCode", new[] { "reason", "retryable" })]
    [InlineData("payment-requires-action", "actionType", new[] { "redirectUrl", "expiresAt" })]
    public async Task Each_union_case_serializes_as_its_own_shape_without_a_discriminator(string presetId, string marker, string[] otherProperties)
    {
        using var response = await SendAsync(ApiPresets.Get(presetId));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await ReadJsonAsync(response);

        string[] expected = [marker, .. otherProperties];
        Assert.Equal(expected.Order(), json.EnumerateObject().Select(p => p.Name).Order());
    }

    [Fact]
    public async Task Wallet_union_case_in_the_request_body_is_classified_structurally()
    {
        var preset = ApiPresets.Get("payment-approved") with
        {
            Body = """{ "orderId": "ord_1001", "amount": 128.50, "currency": "EUR", "method": { "walletProvider": "applepay", "walletToken": "expired" } }""",
        };
        using var response = await SendAsync(preset);
        var json = await ReadJsonAsync(response);
        Assert.Equal("wallet_token_expired", json.GetProperty("declineCode").GetString());
        Assert.True(json.GetProperty("retryable").GetBoolean());
    }

    [Fact]
    public async Task Union_matching_no_case_is_a_400_problem_naming_the_json_path()
    {
        var errors = await ValidationErrorsAsync(ApiPresets.Get("payment-unclassifiable"));
        Assert.Contains("$.method", errors.Keys);
    }

    [Fact]
    public async Task Missing_union_value_is_a_validation_problem()
    {
        var preset = ApiPresets.Get("payment-approved") with { Body = """{ "orderId": "ord_1001", "amount": 128.50, "currency": "EUR" }""" };
        var errors = await ValidationErrorsAsync(preset);
        Assert.Contains("Method", errors.Keys);
    }

    [Theory]
    [InlineData("order-not-found", 404, "not_found")]
    [InlineData("payment-already-paid", 409, "order_already_paid")]
    [InlineData("checkout-stock-conflict", 409, "insufficient_stock")]
    [InlineData("payment-amount-mismatch", 422, "amount_mismatch")]
    [InlineData("unhandled-exception", 500, "unexpected")]
    public async Task Errors_are_rfc9457_problem_details_with_code_instance_and_traceId(string presetId, int status, string code)
    {
        var preset = ApiPresets.Get(presetId);
        using var response = await SendAsync(preset);
        var raw = await response.Content.ReadAsStringAsync(Ct);
        var json = JsonDocument.Parse(raw).RootElement;

        Assert.Equal(status, (int)response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(status, json.GetProperty("status").GetInt32());
        Assert.Equal(code, json.GetProperty("code").GetString());
        Assert.False(string.IsNullOrEmpty(json.GetProperty("title").GetString()));
        Assert.Equal($"{preset.Method} {preset.Path}", json.GetProperty("instance").GetString());
        Assert.Matches("^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9]$", json.GetProperty("traceId").GetString());
        Assert.DoesNotContain("   at ", raw, StringComparison.Ordinal); // no stack trace
    }

    [Fact]
    public async Task Stock_conflict_carries_extension_members()
    {
        using var response = await SendAsync(ApiPresets.Get("checkout-stock-conflict"));
        var json = await ReadJsonAsync(response);
        Assert.Equal(3, json.GetProperty("available").GetInt32());
        Assert.Equal(5, json.GetProperty("requested").GetInt32());
    }

    [Fact]
    public async Task Validation_problems_also_carry_traceId_and_instance()
    {
        using var response = await SendAsync(ApiPresets.Get("checkout-sync-invalid"));
        var json = await ReadJsonAsync(response);
        Assert.Equal("POST /api/checkout", json.GetProperty("instance").GetString());
        Assert.True(json.TryGetProperty("traceId", out _));
    }

    [Fact]
    public async Task Order_events_stream_as_server_sent_events()
    {
        using var response = await SendAsync(ApiPresets.Get("order-events"));
        var body = await response.Content.ReadAsStringAsync(Ct);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(4, body.Split("event: order-stage").Length - 1);
        Assert.Contains("\"stage\":\"shipped\"", body, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Health_and_catalog_respond()
    {
        using var client = factory.CreateClient();
        var health = await client.GetFromJsonAsync<JsonElement>("/api/health", Ct);
        Assert.Equal("ok", health.GetProperty("status").GetString());
        var catalog = await client.GetFromJsonAsync<JsonElement>("/api/catalog", Ct);
        Assert.Equal(4, catalog.GetArrayLength());
    }

    private Task<HttpResponseMessage> SendAsync(ApiPreset preset)
    {
        var client = factory.CreateClient();
        var request = new HttpRequestMessage(new HttpMethod(preset.Method), preset.Path);
        if (preset.Body is not null) request.Content = new StringContent(preset.Body, Encoding.UTF8, "application/json");
        return client.SendAsync(request, Ct);
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync(Ct)).RootElement;

    private async Task<Dictionary<string, string[]>> ValidationErrorsAsync(ApiPreset preset)
    {
        using var response = await SendAsync(preset);
        var json = await ReadJsonAsync(response);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return json.GetProperty("errors").EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.EnumerateArray().Select(v => v.GetString()!).ToArray());
    }

    private static ApiPreset Checkout(string customerId = "cus_1001", string? coupon = null, string country = "GB", bool express = false)
    {
        var body = JsonSerializer.Serialize(new
        {
            customerId,
            currency = "EUR",
            lines = new[] { new { sku = "SKU-MOUSE", quantity = 1 } },
            couponCode = coupon,
            shipTo = new { name = "Test Customer", country, postalCode = "12345", express },
        });
        return new ApiPreset("custom", "Test", "custom", "", "POST", "/api/checkout", body, 0);
    }
}
