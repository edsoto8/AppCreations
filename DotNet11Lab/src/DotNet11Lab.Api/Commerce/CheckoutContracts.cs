using System.ComponentModel.DataAnnotations;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Api.Commerce;

// <snippet:AspNetCore.AsyncAttribute>
/// <summary>
/// .NET 11: an asynchronous DataAnnotations attribute. The lookup awaits a (simulated) remote service and receives
/// the request's CancellationToken, so an aborted request also aborts its validation.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class KnownCustomerAttribute() : AsyncValidationAttribute("Customer '{0}' does not exist or is suspended.")
{
    protected override async Task<ValidationResult?> IsValidAsync(object? value, ValidationContext context, CancellationToken cancellationToken)
    {
        if (value is not string id || id.Length == 0) return ValidationResult.Success; // [Required] owns emptiness

        var directory = context.GetRequiredService<CommerceDirectory>();
        var customer = await directory.FindCustomerAsync(id, cancellationToken);
        return customer is { Suspended: false }
            ? ValidationResult.Success
            : new ValidationResult(FormatErrorMessage(id), [context.MemberName!]);
    }

    // The synchronous path cannot await; async-only attributes refuse to run synchronously.
    protected override ValidationResult IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException($"{nameof(KnownCustomerAttribute)} must be evaluated asynchronously.");
}
// </snippet:AspNetCore.AsyncAttribute>

/// <summary>Async check that a coupon exists and has not expired.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class ValidCouponAttribute() : AsyncValidationAttribute("Coupon '{0}' is unknown or expired.")
{
    protected override async Task<ValidationResult?> IsValidAsync(object? value, ValidationContext context, CancellationToken cancellationToken)
    {
        if (value is not string code || code.Length == 0) return ValidationResult.Success;

        var directory = context.GetRequiredService<CommerceDirectory>();
        var coupon = await directory.FindCouponAsync(code, cancellationToken);
        return coupon is not null && coupon.ExpiresOn >= directory.Today
            ? ValidationResult.Success
            : new ValidationResult(FormatErrorMessage(code), [context.MemberName!]);
    }

    protected override ValidationResult IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException($"{nameof(ValidCouponAttribute)} must be evaluated asynchronously.");
}

/// <summary>Async check that a SKU exists in the catalog. Applied to every item of a collection, validated in parallel.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class KnownSkuAttribute() : AsyncValidationAttribute("SKU '{0}' is not in the catalog.")
{
    protected override async Task<ValidationResult?> IsValidAsync(object? value, ValidationContext context, CancellationToken cancellationToken)
    {
        if (value is not string sku || sku.Length == 0) return ValidationResult.Success;

        var product = await context.GetRequiredService<CommerceDirectory>().FindProductAsync(sku, cancellationToken);
        return product is not null ? ValidationResult.Success : new ValidationResult(FormatErrorMessage(sku), [context.MemberName!]);
    }

    protected override ValidationResult IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException($"{nameof(KnownSkuAttribute)} must be evaluated asynchronously.");
}

// <snippet:AspNetCore.CheckoutRequest>
/// <summary>Body of POST /api/checkout. Sync attributes, async attributes and an async cross-field rule.</summary>
public sealed class CheckoutRequest : IAsyncValidatableObject
{
    [Required, KnownCustomer]
    public string? CustomerId { get; init; }

    [Required, RegularExpression("^[A-Z]{3}$", ErrorMessage = "Currency must be an ISO 4217 code such as EUR.")]
    public string? Currency { get; init; }

    [Required, MinLength(1), MaxLength(20)]
    public List<CheckoutLine>? Lines { get; init; }

    [StringLength(20), ValidCoupon]
    public string? CouponCode { get; init; }

    [Required]
    public ShippingAddress? ShipTo { get; init; }

    /// <summary>Cross-field rule that needs two lookups: is this coupon allowed for this customer?</summary>
    public async IAsyncEnumerable<ValidationResult> ValidateAsync(
        ValidationContext context, [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        // AddValidation() calls only ValidateAsync on an IAsyncValidatableObject (verified: the synchronous
        // Validate below is not invoked), so the async rule set includes the sync rules explicitly.
        foreach (var result in Validate(context)) yield return result;

        if (CouponCode is not { Length: > 0 } || CustomerId is not { Length: > 0 }) yield break;

        var directory = context.GetRequiredService<CommerceDirectory>();
        var customerTask = directory.FindCustomerAsync(CustomerId, cancellationToken);
        var couponTask = directory.FindCouponAsync(CouponCode, cancellationToken);
        var (customer, coupon) = (await customerTask, await couponTask);
        if (customer is null || coupon is null) yield break; // the attributes already reported these

        if (coupon.FirstOrderOnly && customer.PreviousOrders > 0)
            yield return new ValidationResult($"Coupon {coupon.Code} is only valid on a first order; {customer.Name} has {customer.PreviousOrders}.",
                [nameof(CouponCode)]);
        if (coupon.RequiredTier is { } tier && customer.Tier != tier)
            yield return new ValidationResult($"Coupon {coupon.Code} requires the {tier} tier.", [nameof(CouponCode)]);
    }

    /// <summary>Synchronous cross-field rules (also used by synchronous Validator callers).</summary>
    public IEnumerable<ValidationResult> Validate(ValidationContext context)
    {
        if (ShipTo is { Express: true, Country: not ("GB" or "US" or "DE" or "FR") })
            yield return new ValidationResult("Express shipping is only available to GB, US, DE and FR.", [nameof(ShipTo)]);
    }
}

public sealed class CheckoutLine
{
    [Required, KnownSku]
    public string? Sku { get; init; }

    [Range(1, 99)]
    public int Quantity { get; init; }
}

public sealed class ShippingAddress
{
    [Required, StringLength(80, MinimumLength = 2)]
    public string? Name { get; init; }

    [Required, RegularExpression("^[A-Z]{2}$", ErrorMessage = "Country must be an ISO 3166 alpha-2 code.")]
    public string? Country { get; init; }

    [Required, StringLength(12, MinimumLength = 3)]
    public string? PostalCode { get; init; }

    public bool Express { get; init; }
}
// </snippet:AspNetCore.CheckoutRequest>

public sealed record OrderLineView(string Sku, string Name, int Quantity, decimal UnitPrice, decimal LineTotal);

public sealed record OrderView(
    string OrderId,
    string CustomerId,
    string Currency,
    IReadOnlyList<OrderLineView> Lines,
    decimal Subtotal,
    decimal Discount,
    decimal Total,
    string? CouponCode,
    OrderStatus Status,
    DateTimeOffset CreatedAt);

[System.Text.Json.Serialization.JsonConverter(typeof(System.Text.Json.Serialization.JsonStringEnumConverter<OrderStatus>))]
public enum OrderStatus { Pending, Paid }
