using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace DotNet11Lab.Api.Payments;

// <snippet:AspNetCore.PaymentOutcomeUnion>
/// <summary>Response cases. Each has a different shape, so clients can tell them apart without a "$type" field.</summary>
public sealed record PaymentApproved(string PaymentId, string AuthorizationCode, decimal Amount, string Currency, DateTimeOffset ApprovedAt);

public sealed record PaymentDeclined(string DeclineCode, string Reason, bool Retryable);

public sealed record PaymentRequiresAction(string ActionType, string RedirectUrl, DateTimeOffset ExpiresAt);

/// <summary>C# 15 union: serialized as whichever case it holds; OpenAPI describes it as anyOf the three schemas.</summary>
public union PaymentOutcome(PaymentApproved, PaymentDeclined, PaymentRequiresAction);
// </snippet:AspNetCore.PaymentOutcomeUnion>

// <snippet:AspNetCore.PaymentMethodUnion>
public sealed record CardPayment(string CardNumber, int ExpiryMonth, int ExpiryYear, string Cvc);

public sealed record BankTransferPayment(string Iban, string AccountHolder);

public sealed record WalletPayment(string WalletProvider, string WalletToken);

/// <summary>
/// A union in a request body. All three cases are JSON objects, so deserialization needs a classifier: the
/// structural classifier picks the case whose property names match the incoming object (exactly one must match).
/// </summary>
[JsonUnion(TypeClassifier = typeof(JsonUnionTypeStructuralClassifier))]
public union PaymentMethod(CardPayment, BankTransferPayment, WalletPayment);

public sealed class PaymentRequest
{
    [Required, RegularExpression("^ord_[0-9]+$")]
    public string? OrderId { get; init; }

    [Range(typeof(decimal), "0.01", "100000")]
    public decimal Amount { get; init; }

    [Required, RegularExpression("^[A-Z]{3}$")]
    public string? Currency { get; init; }

    public PaymentMethod Method { get; init; }
}
// </snippet:AspNetCore.PaymentMethodUnion>
