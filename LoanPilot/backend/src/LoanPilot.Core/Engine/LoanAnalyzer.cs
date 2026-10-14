using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public enum InterestPaidSource
{
    /// <summary>The user entered it (for example from a statement).</summary>
    Entered = 0,

    /// <summary>Summed from payment records that include an interest split.</summary>
    Records = 1,

    /// <summary>Taken from the original schedule assuming on-time payments (loan without a known balance).</summary>
    Estimated = 2,

    /// <summary>Not enough history to know; never invented.</summary>
    Unknown = 3,
}

public sealed record NextPayment(int Number, DateOnly Date, decimal Amount, decimal Interest, decimal Principal);

/// <summary>Principal plus interest accrued to <see cref="Date"/>. An estimate, not a lender payoff quote.</summary>
public sealed record PayoffEstimate(DateOnly Date, decimal Principal, decimal AccruedInterest, decimal Total);

public sealed record LoanStatus
{
    public required bool IsPaidOff { get; init; }
    public required decimal ScheduledPayment { get; init; }
    public required bool PaymentIsStandard { get; init; }
    public required decimal StandardPayment { get; init; }
    public required int ContractPaymentCount { get; init; }
    public required DateOnly MaturityDate { get; init; }
    public required decimal OriginalScheduleTotalInterest { get; init; }
    public required decimal OriginalScheduleTotalCost { get; init; }
    public required DateOnly ProjectionStartDate { get; init; }
    public required decimal ProjectionStartBalance { get; init; }
    public required int NextPaymentNumber { get; init; }
    public required decimal CurrentBalance { get; init; }
    public required bool BalanceIsEstimated { get; init; }
    public required DateOnly BalanceAsOf { get; init; }
    public required decimal PrincipalRepaid { get; init; }
    public required decimal PercentRepaid { get; init; }
    public required int PaymentsMade { get; init; }
    public required bool PaymentsMadeIsEstimated { get; init; }
    public required decimal? InterestPaidToDate { get; init; }
    public required InterestPaidSource InterestPaidSource { get; init; }
    public required int RemainingPayments { get; init; }
    public required decimal RemainingInterest { get; init; }
    public required DateOnly? PayoffDate { get; init; }
    public required decimal RemainingTotalCost { get; init; }
    public required decimal? ProjectedLifetimeCost { get; init; }
    public required bool LifetimeCostIsEstimated { get; init; }
    public required NextPayment? NextPayment { get; init; }
    public required PayoffEstimate PayoffEstimate { get; init; }
    public required decimal? VehicleValue { get; init; }
    public required decimal? Equity { get; init; }
    public required IReadOnlyList<CalcWarning> Warnings { get; init; }
}

/// <summary>
/// The result of analyzing a loan on a given day: its status, the original contractual schedule, any
/// estimated history, and the baseline projection every scenario is compared with.
/// </summary>
public sealed class LoanAnalysis
{
    internal LoanAnalysis(Loan loan, DateOnly today, DisplayFormat format, AmortizationRequest baseRequest,
        Projection originalSchedule, IReadOnlyList<ScheduleRow> history, Projection baseline, LoanStatus status,
        bool cumulativeFromOrigination)
    {
        Loan = loan;
        Today = today;
        Format = format;
        BaseRequest = baseRequest;
        OriginalSchedule = originalSchedule;
        History = history;
        Baseline = baseline;
        Status = status;
        CumulativeInterestFromOrigination = cumulativeFromOrigination;
    }

    public Loan Loan { get; }
    public DateOnly Today { get; }
    public DisplayFormat Format { get; }
    public AmortizationRequest BaseRequest { get; }
    public Projection OriginalSchedule { get; }

    /// <summary>Reconstructed past rows (estimated) for loans without a known balance; empty otherwise.</summary>
    public IReadOnlyList<ScheduleRow> History { get; }

    public Projection Baseline { get; }
    public LoanStatus Status { get; }

    /// <summary>True when the CumulativeInterest column includes interest before the projection start.</summary>
    public bool CumulativeInterestFromOrigination { get; }

    /// <summary>The earliest date "today"-style actions (lump sums, payoff) can use.</summary>
    public DateOnly EffectiveToday => Today > Status.ProjectionStartDate ? Today : Status.ProjectionStartDate;

    public AmortizationRequest RequestFor(Scenario? scenario) => scenario is null
        ? BaseRequest
        : BaseRequest with
        {
            BudgetPayment = scenario.BudgetPayment,
            RecurringExtras = scenario.RecurringExtras,
            LumpSums = scenario.LumpSums,
        };

    /// <summary>
    /// Projects the loan under a scenario. Lump sums dated before the projection start (the balance
    /// date) are treated as already paid — they are part of the current balance — and are not applied
    /// again; the projection's warnings say so.
    /// </summary>
    public Projection Project(Scenario? scenario)
    {
        if (scenario is null || scenario.IsEmpty)
        {
            return Baseline;
        }

        var paid = AlreadyPaidLumpSums(scenario);
        if (paid.Count == 0)
        {
            return AmortizationEngine.Run(RequestFor(scenario), Format);
        }

        var request = RequestFor(scenario) with { LumpSums = scenario.LumpSums.Where(l => l.Date >= Status.ProjectionStartDate).ToList() };
        var projection = AmortizationEngine.Run(request, Format);
        var notice = new CalcWarning(
            "lump-sum-already-paid",
            (paid.Count == 1
                ? $"The {Format.Money(paid[0].Amount)} lump sum on {Format.LongDate(paid[0].Date)} is"
                : $"{DisplayFormat.Count(paid.Count)} lump sums ({Format.Money(paid.Sum(l => l.Amount))} in total) are") +
            $" dated before your balance date ({Format.LongDate(Status.ProjectionStartDate)}), so {(paid.Count == 1 ? "it is" : "they are")} treated as already paid " +
            "and already reflected in your current balance. The rest of the plan still applies.",
            Severity.Info);
        return projection with { Summary = projection.Summary with { Warnings = [notice, .. projection.Summary.Warnings] } };
    }

    /// <summary>The scenario's lump sums dated before the projection start.</summary>
    public IReadOnlyList<LumpSum> AlreadyPaidLumpSums(Scenario scenario) =>
        scenario.LumpSums.Where(l => l.Date < Status.ProjectionStartDate).OrderBy(l => l.Date).ToList();
}

public static class LoanAnalyzer
{
    /// <summary>A balance older than this is flagged as stale.</summary>
    public const int StaleBalanceDays = 45;

    public static LoanAnalysis Analyze(Loan loan, DateOnly today, IReadOnlyList<PaymentRecord>? records = null,
        DisplayFormat? format = null)
    {
        LoanValidator.EnsureValid(loan, today);
        format ??= DisplayFormat.Default;
        records ??= [];

        var contractCount = loan.PaymentFrequency.PaymentsForTerm(loan.TermMonths);
        var standard = PaymentMath.StandardPayment(loan.OriginalAmount, loan.AprPercent, loan.PaymentFrequency, contractCount);
        var payment = loan.ScheduledPayment is { } entered ? Money.Round(entered) : standard;

        var originalRequest = new AmortizationRequest
        {
            StartingBalance = loan.OriginalAmount,
            StartDate = loan.StartDate,
            FirstPaymentDate = loan.FirstPaymentDate,
            FirstPaymentIndex = 0,
            ScheduledPayment = payment,
            AprPercent = loan.AprPercent,
            Frequency = loan.PaymentFrequency,
            AccrualMethod = loan.AccrualMethod,
            DayCountBasis = loan.DayCountBasis,
            ContractPaymentCount = contractCount,
        };
        var original = AmortizationEngine.Run(originalRequest, format);

        AmortizationRequest baseRequest;
        IReadOnlyList<ScheduleRow> history;
        int paymentsMade;
        decimal? interestPaid;
        InterestPaidSource interestSource;
        bool balanceEstimated;
        bool cumulativeFromOrigination;
        DateOnly projectionStart;

        if (loan.CurrentBalance is { } balance && loan.BalanceAsOf is { } asOf)
        {
            // Existing loan with a known balance: project from the as-of date; history is not reconstructed.
            var nextIndex = PaymentCalendar.FirstIndexAfter(loan.FirstPaymentDate, loan.PaymentFrequency, asOf);
            paymentsMade = loan.PaymentsMade ?? nextIndex;
            var recordInterest = CompleteRecordInterest(records, asOf, paymentsMade);
            (interestPaid, interestSource) = loan.InterestPaidToDate is { } paid
                ? (paid, InterestPaidSource.Entered)
                : recordInterest is { } fromRecords
                    ? (fromRecords, InterestPaidSource.Records)
                    : ((decimal?)null, InterestPaidSource.Unknown);
            // The as-of balance is principal after the last payment; interest has accrued since that
            // payment's due date (or the loan start), not since the as-of date.
            var accrualStart = nextIndex > 0
                ? PaymentCalendar.DueDate(loan.FirstPaymentDate, loan.PaymentFrequency, nextIndex - 1)
                : loan.StartDate;
            projectionStart = asOf;
            baseRequest = originalRequest with
            {
                StartingBalance = balance,
                StartDate = accrualStart,
                FirstPaymentIndex = nextIndex,
                StartingCumulativeInterest = interestPaid ?? 0m,
            };
            history = [];
            balanceEstimated = false;
            cumulativeFromOrigination = interestPaid is not null;
        }
        else
        {
            // No balance entered: estimate it from the original schedule, assuming on-time payments.
            var scheduleRows = original.Rows;
            var made = loan.PaymentsMade ?? PaymentCalendar.CountDueOnOrBefore(loan.FirstPaymentDate, loan.PaymentFrequency, today);
            made = Math.Clamp(made, 0, scheduleRows.Count);
            paymentsMade = made;
            var last = made > 0 ? scheduleRows[made - 1] : null;
            history = scheduleRows.Take(made).Select(r => r with { IsEstimated = true }).ToList();
            var estimatedInterest = last?.CumulativeInterest ?? 0m;
            var recordInterest = CompleteRecordInterest(records, last?.Date ?? loan.StartDate, made);
            projectionStart = last?.Date ?? loan.StartDate;
            (interestPaid, interestSource) = loan.InterestPaidToDate is { } paid
                ? (paid, InterestPaidSource.Entered)
                : recordInterest is { } fromRecords
                    ? (fromRecords, InterestPaidSource.Records)
                    : (estimatedInterest, InterestPaidSource.Estimated);
            baseRequest = originalRequest with
            {
                StartingBalance = last?.EndingBalance ?? loan.OriginalAmount,
                StartingUnpaidInterest = last?.UnpaidInterest ?? 0m,
                StartDate = last?.Date ?? loan.StartDate,
                FirstPaymentIndex = made,
                StartingCumulativeInterest = estimatedInterest,
            };
            balanceEstimated = true;
            cumulativeFromOrigination = true;
        }

        var baseline = AmortizationEngine.Run(baseRequest, format);
        var startBalance = Money.Round(baseRequest.StartingBalance);
        var repaid = Math.Max(0m, loan.OriginalAmount - startBalance);
        var payoffEstimate = EstimatePayoff(baseRequest, baseline, today > projectionStart ? today : projectionStart);
        // The next payment due on or after today (earlier projected payments are assumed made on time).
        var next = baseline.Rows.FirstOrDefault(r => r.Kind == ScheduleRowKind.Payment && r.Date >= today)
            ?? baseline.Rows.FirstOrDefault(r => r.Kind == ScheduleRowKind.Payment);
        var lifetimeCost = interestPaid is { } known ? loan.OriginalAmount + known + baseline.Summary.TotalInterest : (decimal?)null;

        var status = new LoanStatus
        {
            IsPaidOff = startBalance <= 0m && baseRequest.StartingUnpaidInterest <= 0m,
            ScheduledPayment = payment,
            PaymentIsStandard = loan.ScheduledPayment is null || payment == standard,
            StandardPayment = standard,
            ContractPaymentCount = contractCount,
            MaturityDate = PaymentCalendar.DueDate(loan.FirstPaymentDate, loan.PaymentFrequency, contractCount - 1),
            OriginalScheduleTotalInterest = original.Summary.TotalInterest,
            OriginalScheduleTotalCost = loan.OriginalAmount + original.Summary.TotalInterest,
            ProjectionStartDate = projectionStart,
            ProjectionStartBalance = startBalance,
            NextPaymentNumber = baseRequest.FirstPaymentIndex + 1,
            CurrentBalance = startBalance,
            BalanceIsEstimated = balanceEstimated,
            BalanceAsOf = projectionStart,
            PrincipalRepaid = repaid,
            PercentRepaid = Math.Clamp(Money.Percent(repaid, loan.OriginalAmount), 0m, 100m),
            PaymentsMade = paymentsMade,
            PaymentsMadeIsEstimated = loan.PaymentsMade is null,
            InterestPaidToDate = interestPaid,
            InterestPaidSource = interestSource,
            RemainingPayments = baseline.Summary.PaymentCount,
            RemainingInterest = baseline.Summary.TotalInterest,
            PayoffDate = baseline.Summary.PayoffDate,
            RemainingTotalCost = baseline.Summary.TotalPaid,
            ProjectedLifetimeCost = lifetimeCost,
            LifetimeCostIsEstimated = lifetimeCost is not null && (balanceEstimated || interestSource == InterestPaidSource.Estimated),
            NextPayment = next is null ? null : new NextPayment(next.Number ?? 0, next.Date, next.TotalPayment, next.Interest, next.Principal),
            PayoffEstimate = payoffEstimate,
            VehicleValue = loan.VehicleValue,
            Equity = loan.VehicleValue is { } value ? value - payoffEstimate.Total : null,
            Warnings = StatusWarnings(loan, today, payment, standard, startBalance, balanceEstimated, baseline, format),
        };

        return new LoanAnalysis(loan, today, format, baseRequest, original, history, baseline, status, cumulativeFromOrigination);
    }

    /// <summary>
    /// Principal and accrued interest on <paramref name="today"/>, assuming the baseline's scheduled
    /// payments due before that day were made (a payment due today is not yet assumed made). Monthly-accrual loans use Actual/365 daily interest for the
    /// partial period, which is how lenders typically quote payoffs.
    /// </summary>
    public static PayoffEstimate EstimatePayoff(AmortizationRequest request, Projection baseline, DateOnly today)
    {
        var date = today > request.StartDate ? today : request.StartDate;
        var balance = Money.Round(request.StartingBalance);
        var unpaid = Money.Round(request.StartingUnpaidInterest);
        var from = request.StartDate;
        foreach (var row in baseline.Rows)
        {
            if (row.Date >= date)
            {
                break;
            }

            balance = row.EndingBalance;
            unpaid = row.UnpaidInterest;
            from = row.Date;
        }

        var basis = request.AccrualMethod == AccrualMethod.DailySimple ? request.DayCountBasis : DayCountBasis.Actual365;
        var accrued = Money.Round(unpaid + InterestAccrual.Daily(balance, request.AprPercent, from, date, basis));
        return new PayoffEstimate(date, balance, accrued, balance + accrued);
    }

    /// <summary>
    /// Future interest avoided by paying the loan off on the payoff estimate's date: the baseline
    /// payments still due from that day on, minus the payoff amount.
    /// </summary>
    public static decimal InterestAvoidedByPayoff(LoanAnalysis analysis)
    {
        var payoff = analysis.Status.PayoffEstimate;
        var remaining = analysis.Baseline.Rows.Where(r => r.Date >= payoff.Date).Sum(r => r.TotalPayment);
        return Math.Max(0m, remaining - payoff.Total);
    }

    /// <summary>
    /// Interest paid according to payment records, only when they look complete: at least
    /// <paramref name="paymentsMade"/> records up to <paramref name="cutoff"/>, every one with an
    /// interest split. Partial records would understate history, so they count as unknown.
    /// </summary>
    private static decimal? CompleteRecordInterest(IReadOnlyList<PaymentRecord> records, DateOnly cutoff, int paymentsMade)
    {
        var upTo = records.Where(r => r.Date <= cutoff).ToList();
        return upTo.Count > 0 && upTo.Count >= paymentsMade && upTo.All(r => r.Interest is not null)
            ? upTo.Sum(r => r.Interest!.Value)
            : null;
    }

    private static List<CalcWarning> StatusWarnings(Loan loan, DateOnly today, decimal payment, decimal standard,
        decimal balance, bool balanceEstimated, Projection baseline, DisplayFormat format)
    {
        var warnings = new List<CalcWarning>(baseline.Summary.Warnings);

        if (balance <= 0m)
        {
            warnings.Add(new CalcWarning("paid-off", "This loan is paid off.", Severity.Info));
        }
        else if (balanceEstimated)
        {
            warnings.Add(new CalcWarning(
                "estimated-balance",
                "No current balance was entered, so the balance and interest paid are estimated from the original schedule, " +
                "assuming every payment was made on time with no extra payments. Enter the balance from a recent statement for an exact projection.",
                Severity.Info));
        }

        if (!balanceEstimated && loan.BalanceAsOf is { } asOf && today.DayNumber - asOf.DayNumber > StaleBalanceDays)
        {
            warnings.Add(new CalcWarning(
                "stale-balance",
                $"The balance is from {format.LongDate(asOf)} ({DisplayFormat.Count(today.DayNumber - asOf.DayNumber)} days ago). " +
                "Projections start from that date; update it from a recent statement for accuracy.",
                Severity.Warning));
        }

        var firstPeriodDays = loan.FirstPaymentDate.DayNumber - loan.StartDate.DayNumber;
        if (loan.AccrualMethod == AccrualMethod.Monthly && loan.PaymentFrequency == PaymentFrequency.Monthly && firstPeriodDays > 45)
        {
            warnings.Add(new CalcWarning(
                "long-first-period",
                $"The first payment is {DisplayFormat.Count(firstPeriodDays)} days after the loan start. Monthly accrual charges one month of " +
                "interest for that period; lenders using daily interest charge for the actual days, so your first payment may differ.",
                Severity.Info));
        }

        var tolerance = Math.Max(1m, standard * 0.01m);
        if (loan.ScheduledPayment is not null && Math.Abs(payment - standard) > tolerance)
        {
            warnings.Add(new CalcWarning(
                "payment-differs",
                $"Your payment of {format.Money(payment)} differs from the standard payment of {format.Money(standard)} for these terms. " +
                "Fees, add-on products or a different first-period interest can explain this; projections use your payment.",
                Severity.Info));
        }

        if (balance > loan.OriginalAmount)
        {
            warnings.Add(new CalcWarning(
                "balance-exceeds-original",
                $"The current balance ({format.Money(balance)}) is higher than the original loan amount ({format.Money(loan.OriginalAmount)}). " +
                "Check the figures; this usually means fees or unpaid interest were added to the loan.",
                Severity.Warning));
        }

        return warnings.DistinctBy(w => w.Code).ToList();
    }
}
