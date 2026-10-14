namespace LoanPilot.Core.Domain;

/// <summary>
/// An auto loan profile as the user entered it. Money is in dollars, the APR is a percentage
/// (6.49 means 6.49 %). Optional "current status" fields describe an existing loan; when
/// <see cref="CurrentBalance"/> is set, projections start from <see cref="BalanceAsOf"/> instead of
/// reconstructing the loan's history.
/// </summary>
public sealed class Loan
{
    public long Id { get; set; }

    // Vehicle and lender
    public string Name { get; set; } = "";
    public string? VehicleMake { get; set; }
    public string? VehicleModel { get; set; }
    public int? VehicleYear { get; set; }
    public string? Lender { get; set; }

    // Original terms
    public decimal OriginalAmount { get; set; }
    public decimal? DownPayment { get; set; }
    public decimal AprPercent { get; set; }
    public int TermMonths { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly FirstPaymentDate { get; set; }

    /// <summary>The regular payment. Null means "use the standard amortized payment for these terms".</summary>
    public decimal? ScheduledPayment { get; set; }

    public PaymentFrequency PaymentFrequency { get; set; } = PaymentFrequency.Monthly;
    public AccrualMethod AccrualMethod { get; set; } = AccrualMethod.Monthly;
    public DayCountBasis DayCountBasis { get; set; } = DayCountBasis.Actual365;

    // Current status of an existing loan (all optional)
    public decimal? CurrentBalance { get; set; }
    public DateOnly? BalanceAsOf { get; set; }
    public int? PaymentsMade { get; set; }
    public decimal? InterestPaidToDate { get; set; }

    // Optional extras
    public decimal? VehicleValue { get; set; }
    public string? Notes { get; set; }

    public bool IsArchived { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public Loan Clone() => (Loan)MemberwiseClone();
}
