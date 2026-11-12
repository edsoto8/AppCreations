using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Http.HttpResults;

namespace DotNet11Lab.Api.Commerce;

/// <summary>
/// .NET 10-style body: only synchronous attributes, because DataAnnotations could not await anything.
/// Every remote check moves into the handler.
/// </summary>
public sealed class LegacyCheckoutRequest
{
    [Required] public string? CustomerId { get; init; }
    [Required, RegularExpression("^[A-Z]{3}$", ErrorMessage = "Currency must be an ISO 4217 code such as EUR.")] public string? Currency { get; init; }
    [Required, MinLength(1), MaxLength(20)] public List<LegacyCheckoutLine>? Lines { get; init; }
    [StringLength(20)] public string? CouponCode { get; init; }
    [Required] public ShippingAddress? ShipTo { get; init; }
}

public sealed class LegacyCheckoutLine
{
    [Required] public string? Sku { get; init; }
    [Range(1, 99)] public int Quantity { get; init; }
}

public static class LegacyCheckoutEndpoint
{
    // <snippet:AspNetCore.LegacyManualValidation>
    /// <summary>
    /// The pre-.NET 11 pattern: validate synchronously with Validator, recurse into nested objects by hand,
    /// then run every async lookup and cross-field rule imperatively before doing any real work.
    /// </summary>
    public static async Task<Results<Created<OrderView>, ValidationProblem, ProblemHttpResult>> HandleAsync(
        LegacyCheckoutRequest request, CommerceDirectory directory, CheckoutService checkout, CancellationToken cancellationToken)
    {
        var errors = new Dictionary<string, List<string>>();
        void Add(string key, string message) => (errors.TryGetValue(key, out var list) ? list : errors[key] = []).Add(message);

        // 1. Synchronous attributes. Validator does not recurse, so nested objects and items are walked manually.
        ValidateSync(request, "", Add);
        if (request.ShipTo is not null) ValidateSync(request.ShipTo, "ShipTo.", Add);
        for (var i = 0; i < (request.Lines?.Count ?? 0); i++) ValidateSync(request.Lines![i], $"Lines[{i}].", Add);
        if (errors.Count > 0) return TypedResults.ValidationProblem(Flatten(errors));

        // 2. Async lookups, written (and sequenced) by hand.
        var customer = await directory.FindCustomerAsync(request.CustomerId!, cancellationToken);
        if (customer is null or { Suspended: true }) Add("CustomerId", $"Customer '{request.CustomerId}' does not exist or is suspended.");

        Coupon? coupon = null;
        if (request.CouponCode is { Length: > 0 } code)
        {
            coupon = await directory.FindCouponAsync(code, cancellationToken);
            if (coupon is null || coupon.ExpiresOn < directory.Today) Add("CouponCode", $"Coupon '{code}' is unknown or expired.");
        }

        for (var i = 0; i < request.Lines!.Count; i++)
        {
            if (await directory.FindProductAsync(request.Lines[i].Sku!, cancellationToken) is null)
                Add($"Lines[{i}].Sku", $"SKU '{request.Lines[i].Sku}' is not in the catalog.");
        }

        // 3. Cross-field rules, also by hand.
        if (customer is not null && coupon is not null)
        {
            if (coupon.FirstOrderOnly && customer.PreviousOrders > 0)
                Add("CouponCode", $"Coupon {coupon.Code} is only valid on a first order; {customer.Name} has {customer.PreviousOrders}.");
            if (coupon.RequiredTier is { } tier && customer.Tier != tier)
                Add("CouponCode", $"Coupon {coupon.Code} requires the {tier} tier.");
        }
        if (request.ShipTo is { Express: true, Country: not ("GB" or "US" or "DE" or "FR") })
            Add("ShipTo", "Express shipping is only available to GB, US, DE and FR.");

        if (errors.Count > 0) return TypedResults.ValidationProblem(Flatten(errors));

        var result = await checkout.PlaceOrderAsync(request.CustomerId!, request.Currency!,
            request.Lines.Select(l => (l.Sku!, l.Quantity)), request.CouponCode, cancellationToken);
        return CommerceEndpoints.ToHttpResult(result);
    }

    private static void ValidateSync(object instance, string prefix, Action<string, string> add)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(instance, new ValidationContext(instance), results, validateAllProperties: true);
        foreach (var result in results)
            foreach (var member in result.MemberNames.DefaultIfEmpty(""))
                add(prefix + member, result.ErrorMessage ?? "Invalid value.");
    }

    private static Dictionary<string, string[]> Flatten(Dictionary<string, List<string>> errors) =>
        errors.ToDictionary(e => e.Key, e => e.Value.ToArray());
    // </snippet:AspNetCore.LegacyManualValidation>
}
