using System.ComponentModel.DataAnnotations;
using DotNet11Lab.Api.Commerce;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab3AspNetCore;

/// <summary>The async DataAnnotations APIs used outside ASP.NET Core, straight from System.ComponentModel.Annotations.</summary>
public class AsyncValidationModelTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    private static ServiceProvider Services(TimeSpan latency) => new ServiceCollection()
        .AddSingleton(TimeProvider.System)
        .AddSingleton(new CommerceDirectoryOptions { LookupLatency = latency })
        .AddSingleton<CommerceDirectory>()
        .BuildServiceProvider();

    private static CheckoutRequest Request(string customer = "cus_1001", string? coupon = null) => new()
    {
        CustomerId = customer,
        Currency = "EUR",
        CouponCode = coupon,
        Lines = [new CheckoutLine { Sku = "SKU-MOUSE", Quantity = 1 }],
        ShipTo = new ShippingAddress { Name = "Ada", Country = "GB", PostalCode = "SW1A" },
    };

    [Fact]
    public async Task TryValidateObjectAsync_runs_async_attributes_and_the_async_object_rule()
    {
        using var services = Services(TimeSpan.Zero);
        var request = Request(coupon: "WELCOME10");
        var results = new List<ValidationResult>();

        var valid = await Validator.TryValidateObjectAsync(request, new ValidationContext(request, services, null), results, validateAllProperties: true, Ct);

        Assert.False(valid);
        Assert.Contains(results, r => r.MemberNames.Contains("CouponCode") && r.ErrorMessage!.Contains("first order", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Unknown_customer_fails_the_async_attribute()
    {
        using var services = Services(TimeSpan.Zero);
        var request = Request(customer: "cus_4242");
        var results = new List<ValidationResult>();

        Assert.False(await Validator.TryValidateObjectAsync(request, new ValidationContext(request, services, null), results, true, Ct));
        Assert.Contains(results, r => r.MemberNames.Contains("CustomerId"));
    }

    [Fact]
    public async Task Async_attribute_observes_cancellation()
    {
        using var services = Services(TimeSpan.FromSeconds(30));
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        cts.CancelAfter(TimeSpan.FromMilliseconds(50));
        var request = Request();
        var context = new ValidationContext(request, services, null) { MemberName = nameof(CheckoutRequest.CustomerId) };

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new KnownCustomerAttribute().GetValidationResultAsync("cus_1001", context, cts.Token));
    }

    [Fact]
    public void Synchronous_validation_cannot_run_an_async_only_attribute()
    {
        using var services = Services(TimeSpan.Zero);
        var request = Request();
        var context = new ValidationContext(request, services, null) { MemberName = nameof(CheckoutRequest.CustomerId) };

        Assert.ThrowsAny<Exception>(() => new KnownCustomerAttribute().GetValidationResult("cus_1001", context));
    }
}
