namespace DotNet11Lab.Api.Payments;

/// <summary>
/// Deterministic fake gateway. Test card numbers follow the usual sandbox convention:
/// ending in 0002 is declined, ending in 3220 needs 3-D Secure, anything else is approved.
/// </summary>
public sealed class PaymentProcessor(TimeProvider time)
{
    // <snippet:AspNetCore.AuthorizeSwitch>
    public PaymentOutcome Authorize(PaymentRequest request)
    {
        var now = time.GetUtcNow();
        // Patterns test the value inside the union; the switch is exhaustive over the three case types.
        return request.Method switch
        {
            CardPayment card when card.CardNumber.EndsWith("0002", StringComparison.Ordinal) =>
                new PaymentDeclined("card_declined", "The issuer declined the card.", Retryable: false),
            CardPayment card when card.CardNumber.EndsWith("3220", StringComparison.Ordinal) =>
                new PaymentRequiresAction("three_d_secure", $"https://pay.example/3ds/{request.OrderId}", now.AddMinutes(15)),
            CardPayment => Approve(request, now),
            BankTransferPayment => new PaymentRequiresAction("bank_redirect", $"https://pay.example/bank/{request.OrderId}", now.AddHours(1)),
            WalletPayment { WalletToken: "expired" } =>
                new PaymentDeclined("wallet_token_expired", "The wallet token has expired; ask the customer to re-authenticate.", Retryable: true),
            WalletPayment => Approve(request, now),
            null => throw new ArgumentException("A payment method is required.", nameof(request)),
        };
    }
    // </snippet:AspNetCore.AuthorizeSwitch>

    private static PaymentApproved Approve(PaymentRequest request, DateTimeOffset now) =>
        new($"pay_{Guid.CreateVersion7(now):N}"[..20], $"A{Random.Shared.Next(100_000, 999_999)}", request.Amount, request.Currency!, now);
}
