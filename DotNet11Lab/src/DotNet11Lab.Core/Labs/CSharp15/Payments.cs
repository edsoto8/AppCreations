using System.Globalization;

namespace DotNet11Lab.Core.Labs.CSharp15;

/// <summary>A card payment request submitted by the checkout.</summary>
public sealed record PaymentRequest(string OrderId, decimal Amount, string CardNumber, string Currency = "USD")
{
    public string CardLast4 => CardNumber.Length >= 4 ? CardNumber[^4..] : CardNumber;
}

// <snippet:CSharp15.PaymentCases>
public sealed record PaymentApproved(string AuthorizationCode, decimal Amount, string CardLast4);
public sealed record PaymentDeclined(string DeclineCode, string Reason);
public sealed record PaymentPending(string ReviewTicket, string Queue, TimeSpan ExpectedWait);

// The union is a closed set of *unrelated* types: no shared base class, no marker interface.
public union PaymentResult(PaymentApproved, PaymentDeclined, PaymentPending);
// </snippet:CSharp15.PaymentCases>

/// <summary>A fake card processor with deterministic, documented rules (no network calls).</summary>
public static class PaymentProcessor
{
    public const decimal ManualReviewThreshold = 10_000m;

    // <snippet:CSharp15.ProcessPayment>
    public static PaymentResult Process(PaymentRequest request)
    {
        if (request.Amount <= 0)
            return new PaymentDeclined("D-INVALID", "Amount must be positive");   // implicit union conversion
        if (request.CardLast4 == "0002")
            return new PaymentDeclined("D-51", "Insufficient funds");
        if (request.CardLast4 == "0069")
            return new PaymentDeclined("D-54", "Card expired");
        if (request.Amount > ManualReviewThreshold)
            return new PaymentPending($"RV-{StableHash(request.OrderId) % 100_000:00000}", "fraud-review", TimeSpan.FromMinutes(30));

        return new PaymentApproved(AuthCode(request), request.Amount, request.CardLast4);
    }
    // </snippet:CSharp15.ProcessPayment>

    // <snippet:CSharp15.DescribePayment>
    public static string Describe(PaymentResult result) => result switch
    {
        PaymentApproved a => $"Approved {a.Amount:N2} USD on card •••• {a.CardLast4} (auth {a.AuthorizationCode})",
        PaymentDeclined d => $"Declined: {d.Reason} [{d.DeclineCode}]",
        PaymentPending p => $"Pending manual review in '{p.Queue}' (ticket {p.ReviewTicket}, ~{p.ExpectedWait.TotalMinutes:0} min)",
        null => "No payment attempted",   // default(PaymentResult) has a null Value
        // No '_' arm: add a fourth case type and this switch stops compiling cleanly (CS8509).
    };
    // </snippet:CSharp15.DescribePayment>

    /// <summary>Same switch without the null arm, used to show what <c>default(PaymentResult)</c> does at runtime.</summary>
    public static string DescribeWithoutNullArm(PaymentResult result) => result switch
    {
        PaymentApproved => "approved",
        PaymentDeclined => "declined",
        PaymentPending => "pending",
    };

    private static string AuthCode(PaymentRequest request)
    {
        // Deterministic so the demo and the tests are reproducible.
        return "A" + (StableHash(request.OrderId + request.CardNumber) % 1_000_000).ToString("000000", CultureInfo.InvariantCulture);
    }

    // string.GetHashCode is randomized per process; this one is stable across runs.
    private static int StableHash(string text)
    {
        var hash = 17;
        foreach (var c in text) hash = unchecked(hash * 31 + c);
        return hash & int.MaxValue;
    }
}

/// <summary>Ready-made checkout scenarios shown in the UI.</summary>
public static class PaymentScenarios
{
    public static IReadOnlyList<(string Name, PaymentRequest Request)> All { get; } =
    [
        ("Everyday purchase", new("ORD-1001", 89.90m, "4111111111111111")),
        ("Insufficient funds", new("ORD-1002", 249.00m, "4000000000000002")),
        ("Expired card", new("ORD-1003", 15.00m, "4000000000000069")),
        ("High-value order", new("ORD-1004", 18_450.00m, "5555555555554444")),
        ("Zero amount", new("ORD-1005", 0m, "4111111111111111")),
    ];
}

// <snippet:CSharp15.LegacyPayment>
// C# 14: an abstract base record stands in for "one of these". Anyone can add a subclass, so the
// compiler cannot prove the switch is complete and a discard arm is mandatory.
public abstract record LegacyPaymentResult;
public sealed record LegacyApproved(string AuthorizationCode, decimal Amount, string CardLast4) : LegacyPaymentResult;
public sealed record LegacyDeclined(string DeclineCode, string Reason) : LegacyPaymentResult;
public sealed record LegacyPending(string ReviewTicket, string Queue, TimeSpan ExpectedWait) : LegacyPaymentResult;

public static class LegacyPaymentFormatter
{
    public static string Describe(LegacyPaymentResult result) => result switch
    {
        LegacyApproved a => $"Approved {a.Amount:N2} USD on card •••• {a.CardLast4} (auth {a.AuthorizationCode})",
        LegacyDeclined d => $"Declined: {d.Reason} [{d.DeclineCode}]",
        LegacyPending p => $"Pending manual review in '{p.Queue}' (ticket {p.ReviewTicket})",
        _ => throw new ArgumentOutOfRangeException(nameof(result), result, "Unknown payment result"),
        // ^ a new subclass compiles fine and fails here, at runtime, in production.
    };
}
// </snippet:CSharp15.LegacyPayment>

/// <summary>Converts the union to the legacy shape so the UI can run both approaches on the same input.</summary>
public static class LegacyPaymentProcessor
{
    public static LegacyPaymentResult Process(PaymentRequest request) => PaymentProcessor.Process(request) switch
    {
        PaymentApproved a => new LegacyApproved(a.AuthorizationCode, a.Amount, a.CardLast4),
        PaymentDeclined d => new LegacyDeclined(d.DeclineCode, d.Reason),
        PaymentPending p => new LegacyPending(p.ReviewTicket, p.Queue, p.ExpectedWait),
        null => throw new InvalidOperationException("Processor returned no result."),
    };
}
