using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public enum ScheduleRowKind
{
    Payment = 0,
    LumpSum = 1,
}

public enum Severity
{
    Info = 0,
    Warning = 1,
    Critical = 2,
}

public sealed record CalcWarning(string Code, string Message, Severity Severity);

/// <summary>
/// One posting in a schedule. <see cref="Interest"/> is the interest charged for the period the row
/// closes; <see cref="UnpaidInterest"/> is interest still owed afterwards (only non-zero when payments
/// do not cover the interest). Total payment = interest paid + principal.
/// </summary>
public sealed record ScheduleRow(
    int? Number,
    DateOnly Date,
    ScheduleRowKind Kind,
    decimal StartingBalance,
    decimal ScheduledPayment,
    decimal ExtraPayment,
    decimal TotalPayment,
    decimal Interest,
    decimal Principal,
    decimal EndingBalance,
    decimal CumulativeInterest,
    decimal UnpaidInterest,
    bool IsEstimated = false)
{
    /// <summary>The part of <see cref="ExtraPayment"/> that came from recurring extras or a budget surplus (not lump sums).</summary>
    public decimal RecurringExtra { get; init; }
}

public sealed record ProjectionSummary(
    bool PaysOff,
    DateOnly? PayoffDate,
    int PaymentCount,
    int MonthsToPayoff,
    decimal TotalInterest,
    decimal TotalPaid,
    decimal TotalExtra,
    decimal FinalPayment,
    IReadOnlyList<CalcWarning> Warnings);

public sealed record Projection(ProjectionSummary Summary, IReadOnlyList<ScheduleRow> Rows)
{
    /// <summary>Principal + unpaid interest owed right after the last row (0 when paid off).</summary>
    public decimal EndingOwed => Rows.Count == 0 ? 0m : Rows[^1].EndingBalance + Rows[^1].UnpaidInterest;
}

/// <summary>
/// Everything the amortization engine needs to project a loan forward from a known state.
/// </summary>
public sealed record AmortizationRequest
{
    /// <summary>Principal outstanding at <see cref="StartDate"/>.</summary>
    public required decimal StartingBalance { get; init; }

    /// <summary>Interest already charged but not yet paid at <see cref="StartDate"/>.</summary>
    public decimal StartingUnpaidInterest { get; init; }

    /// <summary>Cumulative interest before the start (only affects the CumulativeInterest column).</summary>
    public decimal StartingCumulativeInterest { get; init; }

    /// <summary>Date the state is known at; daily interest accrues from here.</summary>
    public required DateOnly StartDate { get; init; }

    /// <summary>The loan's first payment date: the anchor every due date is computed from.</summary>
    public required DateOnly FirstPaymentDate { get; init; }

    /// <summary>Zero-based calendar index of the first payment to project (payment number = index + 1).</summary>
    public required int FirstPaymentIndex { get; init; }

    public required decimal ScheduledPayment { get; init; }
    public required decimal AprPercent { get; init; }
    public PaymentFrequency Frequency { get; init; } = PaymentFrequency.Monthly;
    public AccrualMethod AccrualMethod { get; init; } = AccrualMethod.Monthly;
    public DayCountBasis DayCountBasis { get; init; } = DayCountBasis.Actual365;

    /// <summary>
    /// The contract's final payment number. When a residual smaller than one regular payment would
    /// remain after it, that residual is added to this payment (final payment adjustment).
    /// </summary>
    public int? ContractPaymentCount { get; init; }

    /// <summary>Total paid per period instead of <see cref="ScheduledPayment"/> (budget-based payoff).</summary>
    public decimal? BudgetPayment { get; init; }

    public IReadOnlyList<RecurringExtra> RecurringExtras { get; init; } = [];
    public IReadOnlyList<LumpSum> LumpSums { get; init; } = [];

    /// <summary>Rows are marked as estimated history (used for reconstructed past payments).</summary>
    public bool MarkEstimated { get; init; }

    /// <summary>Projection stops (as not paid off) after this many years.</summary>
    public int HorizonYears { get; init; } = 50;
}
