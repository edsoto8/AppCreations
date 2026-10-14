using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Api;

// Request and response shapes that are not engine types. Engine records are serialized as-is
// (camelCase, enums as camelCase strings, DateOnly as yyyy-MM-dd); see docs/API.md.

public sealed record LoanInput
{
    public string? Name { get; init; }
    public string? VehicleMake { get; init; }
    public string? VehicleModel { get; init; }
    public int? VehicleYear { get; init; }
    public string? Lender { get; init; }
    public decimal OriginalAmount { get; init; }
    public decimal? DownPayment { get; init; }
    public decimal AprPercent { get; init; }
    public int TermMonths { get; init; }
    public DateOnly? StartDate { get; init; }
    public DateOnly? FirstPaymentDate { get; init; }
    public decimal? ScheduledPayment { get; init; }
    public PaymentFrequency PaymentFrequency { get; init; } = PaymentFrequency.Monthly;
    public AccrualMethod AccrualMethod { get; init; } = AccrualMethod.Monthly;
    public DayCountBasis DayCountBasis { get; init; } = DayCountBasis.Actual365;
    public decimal? CurrentBalance { get; init; }
    public DateOnly? BalanceAsOf { get; init; }
    public int? PaymentsMade { get; init; }
    public decimal? InterestPaidToDate { get; init; }
    public decimal? VehicleValue { get; init; }
    public string? Notes { get; init; }

    /// <summary>Maps to a domain loan, reporting missing required dates as validation errors.</summary>
    public Loan ToLoan(DateOnly today, long id = 0)
    {
        var missing = new List<ValidationError>();
        if (StartDate is null)
        {
            missing.Add(new ValidationError("startDate", "Enter the date the loan started."));
        }

        if (FirstPaymentDate is null)
        {
            missing.Add(new ValidationError("firstPaymentDate", "Enter the date of the first payment."));
        }

        var loan = new Loan
        {
            Id = id,
            Name = Name?.Trim() ?? "",
            VehicleMake = Clean(VehicleMake),
            VehicleModel = Clean(VehicleModel),
            VehicleYear = VehicleYear,
            Lender = Clean(Lender),
            OriginalAmount = OriginalAmount,
            DownPayment = DownPayment,
            AprPercent = AprPercent,
            TermMonths = TermMonths,
            StartDate = StartDate ?? default,
            FirstPaymentDate = FirstPaymentDate ?? default,
            ScheduledPayment = ScheduledPayment,
            PaymentFrequency = PaymentFrequency,
            AccrualMethod = AccrualMethod,
            DayCountBasis = DayCountBasis,
            CurrentBalance = CurrentBalance,
            BalanceAsOf = BalanceAsOf,
            PaymentsMade = PaymentsMade,
            InterestPaidToDate = InterestPaidToDate,
            VehicleValue = VehicleValue,
            Notes = Clean(Notes),
        };

        var errors = missing.Concat(LoanValidator.Validate(loan, today)
            .Where(e => missing.Count == 0 || e.Field is not ("startDate" or "firstPaymentDate"))).ToList();
        if (errors.Count > 0)
        {
            throw new LoanValidationException(errors);
        }

        return loan;
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

public sealed record RecurringExtraInput(decimal Amount, DateOnly? StartDate = null, DateOnly? EndDate = null);

public sealed record LumpSumInput(decimal Amount, DateOnly Date, string? Note = null);

public sealed record ScenarioInput
{
    public string? Name { get; init; }
    public string? Description { get; init; }
    public decimal? BudgetPayment { get; init; }
    public List<RecurringExtraInput>? RecurringExtras { get; init; }
    public List<LumpSumInput>? LumpSums { get; init; }

    public Scenario ToScenario(long loanId = 0, long id = 0) => new()
    {
        Id = id,
        LoanId = loanId,
        Name = Name?.Trim() ?? "",
        Description = string.IsNullOrWhiteSpace(Description) ? null : Description.Trim(),
        BudgetPayment = BudgetPayment,
        RecurringExtras = (RecurringExtras ?? []).Select(e => new RecurringExtra(e.Amount, e.StartDate, e.EndDate)).ToList(),
        LumpSums = (LumpSums ?? []).Select(l => new LumpSum(l.Amount, l.Date, string.IsNullOrWhiteSpace(l.Note) ? null : l.Note.Trim())).ToList(),
    };
}

public sealed record LoanListItem(Loan Loan, decimal CurrentBalance, decimal PercentRepaid, decimal ScheduledPayment, DateOnly? PayoffDate, bool IsPaidOff);

public sealed record PreviewResult(LoanStatus Status, ProjectionSummary Baseline);

public sealed record DashboardSavingsOption(string Label, decimal ExtraMonthly, decimal LumpSum, decimal InterestSaved, int MonthsSaved, DateOnly? NewPayoffDate);

public sealed record Dashboard(Loan Loan, LoanStatus Status, Projection Baseline, IReadOnlyList<DashboardSavingsOption> SavingsOptions, IReadOnlyList<Insight> Insights);

public sealed record TargetPayoffRequest(DateOnly? TargetDate);

public sealed record BudgetRequest(decimal? Budget);

public sealed record ScheduleResponse(
    IReadOnlyList<ScheduleRow> History,
    Projection Baseline,
    Projection? Scenario,
    IReadOnlyList<AnnualSummaryRow> BaselineAnnual,
    IReadOnlyList<AnnualSummaryRow>? ScenarioAnnual,
    string CumulativeInterestFrom);

public sealed record ExportRequest(long? ScenarioId, ScenarioInput? Scenario);

public sealed record PaymentRecordInput(DateOnly? Date, decimal Amount, decimal? Principal = null, decimal? Interest = null, string? Note = null);

public sealed record ImportResult(int Imported, int Skipped, IReadOnlyList<ImportError> Errors);
