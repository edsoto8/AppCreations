using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

/// <summary>
/// Projects a loan forward payment by payment. Allocation rules (see docs/CALCULATIONS.md):
/// <list type="number">
/// <item>Each payment pays interest owed first (carried unpaid interest, then this period's interest), then principal.</item>
/// <item>Extra amounts paid with a regular payment (recurring extras, budget surplus, lump sums dated on
/// or credited to that payment) are added to it and, after interest, reduce principal.</item>
/// <item>Under daily accrual a lump sum dated between payments posts on its own date as a principal-only
/// payment; it stops interest accruing on that principal from that day.</item>
/// <item>Under monthly (periodic) accrual a lump sum is credited with the first payment due on or after its date.</item>
/// <item>Extra payments never reduce or skip later scheduled payments: the loan simply ends sooner.</item>
/// <item>Unpaid interest is never compounded into principal; the balance cannot go negative and
/// payments are capped at the amount owed.</item>
/// </list>
/// </summary>
public static class AmortizationEngine
{
    public static Projection Run(AmortizationRequest request, DisplayFormat? format = null)
    {
        format ??= DisplayFormat.Default;
        var state = new State(request);
        var lumps = request.LumpSums.OrderBy(l => l.Date).ToList();
        var lumpIndex = 0;
        var horizon = request.StartDate.AddYears(request.HorizonYears);
        var daily = request.AccrualMethod == AccrualMethod.DailySimple;
        var regular = Money.Round(request.ScheduledPayment);
        var budgetSurplus = request.BudgetPayment is { } budget ? Math.Max(0m, Money.Round(budget) - regular) : 0m;
        var index = request.FirstPaymentIndex;
        var reachedHorizon = false;

        while (!state.PaidOff)
        {
            var due = PaymentCalendar.DueDate(request.FirstPaymentDate, request.Frequency, index);
            if (due > horizon)
            {
                reachedHorizon = true;
                break;
            }

            var lumpExtra = 0m;
            while (!state.PaidOff && lumpIndex < lumps.Count && lumps[lumpIndex].Date <= due)
            {
                var lump = lumps[lumpIndex++];
                if (daily && lump.Date < due)
                {
                    state.PostLumpSum(lump);
                }
                else
                {
                    lumpExtra += Money.Round(lump.Amount);
                }
            }

            if (state.PaidOff)
            {
                break;
            }

            var recurring = budgetSurplus + ActiveRecurringExtra(request.RecurringExtras, due);
            state.PostPayment(index + 1, due, regular, recurring, lumpExtra);
            index++;
        }

        var warnings = new List<CalcWarning>();
        AddWarnings(request, state, regular, reachedHorizon, lumps.Count - lumpIndex, format, warnings);

        var rows = state.Rows;
        var paymentRows = rows.Where(r => r.Kind == ScheduleRowKind.Payment).ToList();
        DateOnly? payoff = state.PaidOff && rows.Count > 0 ? rows[^1].Date : state.PaidOff ? request.StartDate : null;
        var lastDate = rows.Count > 0 ? rows[^1].Date : request.StartDate;
        var summary = new ProjectionSummary(
            PaysOff: state.PaidOff,
            PayoffDate: payoff,
            PaymentCount: paymentRows.Count,
            MonthsToPayoff: Math.Max(0, PaymentCalendar.MonthsBetween(request.StartDate, payoff ?? lastDate)),
            TotalInterest: rows.Sum(r => r.Interest),
            TotalPaid: rows.Sum(r => r.TotalPayment),
            TotalExtra: rows.Sum(r => r.ExtraPayment),
            FinalPayment: rows.Count > 0 ? rows[^1].TotalPayment : 0m,
            Warnings: warnings);
        return new Projection(summary, rows);
    }

    /// <summary>Sum of the recurring extras whose date window contains <paramref name="date"/>.</summary>
    public static decimal ActiveRecurringExtra(IReadOnlyList<RecurringExtra> extras, DateOnly date)
    {
        var total = 0m;
        foreach (var extra in extras)
        {
            if ((extra.StartDate is null || extra.StartDate <= date) && (extra.EndDate is null || date <= extra.EndDate))
            {
                total += Money.Round(extra.Amount);
            }
        }

        return total;
    }

    private static void AddWarnings(
        AmortizationRequest request, State state, decimal regular, bool reachedHorizon, int lumpsNotApplied,
        DisplayFormat format, List<CalcWarning> warnings)
    {
        if (state.FirstShortfall is { } shortfall)
        {
            warnings.Add(new CalcWarning(
                "insufficient-payment",
                $"The payment on {format.LongDate(shortfall.Date)} ({format.Money(shortfall.Paid)}) does not exceed the " +
                $"{format.Money(shortfall.Interest)} of interest charged for that period, so the principal balance does not go down. " +
                "Unpaid interest is carried forward (not added to principal) and must be paid before principal is reduced.",
                state.PaidOff ? Severity.Warning : Severity.Critical));
        }

        if (!state.PaidOff && reachedHorizon)
        {
            warnings.Add(new CalcWarning(
                "never-pays-off",
                $"At {format.Money(regular)} per payment this loan is not repaid within {request.HorizonYears} years. " +
                "Increase the payment so it covers the interest and reduces principal.",
                Severity.Critical));
        }

        if (state.FinalAdjustment is { } adjustment && adjustment >= 1m)
        {
            var balloon = adjustment > regular * 0.10m;
            warnings.Add(new CalcWarning(
                balloon ? "balloon-final-payment" : "final-payment-adjusted",
                $"The final scheduled payment is increased by {format.Money(adjustment)} to retire the remaining balance at maturity" +
                (balloon ? $" — a balloon payment well above the regular {format.Money(regular)}." : "."),
                balloon ? Severity.Warning : Severity.Info));
        }

        if (request.ContractPaymentCount is { } contract && state.PaidOff &&
            state.Rows.Any(r => r.Kind == ScheduleRowKind.Payment && r.Number > contract))
        {
            var extraPayments = state.Rows.Count(r => r.Kind == ScheduleRowKind.Payment && r.Number > contract);
            warnings.Add(new CalcWarning(
                "beyond-maturity",
                $"At {format.Money(regular)} per payment the loan is not repaid by its scheduled final payment (#{contract}); " +
                $"{DisplayFormat.Count(extraPayments)} more payment{(extraPayments == 1 ? " is" : "s are")} needed. " +
                "Check the payment amount or balance with your lender.",
                Severity.Warning));
        }

        if (state.CappedLumpSum is { } capped)
        {
            warnings.Add(new CalcWarning(
                "lump-sum-capped",
                $"The lump sum on {format.LongDate(capped)} is more than the amount owed; only the payoff amount is applied.",
                Severity.Info));
        }

        if (lumpsNotApplied > 0 && !state.PaidOff)
        {
            warnings.Add(new CalcWarning(
                "lump-sum-beyond-horizon",
                $"{DisplayFormat.Count(lumpsNotApplied)} lump-sum payment{(lumpsNotApplied == 1 ? " is" : "s are")} dated beyond the " +
                $"{request.HorizonYears}-year projection and {(lumpsNotApplied == 1 ? "was" : "were")} not applied.",
                Severity.Info));
        }
        else if (lumpsNotApplied > 0)
        {
            warnings.Add(new CalcWarning(
                "lump-sum-after-payoff",
                $"{DisplayFormat.Count(lumpsNotApplied)} lump-sum payment{(lumpsNotApplied == 1 ? " is" : "s are")} dated after the loan is already paid off and " +
                $"{(lumpsNotApplied == 1 ? "was" : "were")} not applied.",
                Severity.Info));
        }
    }

    private sealed record Shortfall(DateOnly Date, decimal Interest, decimal Paid);

    /// <summary>Mutable running state of one projection.</summary>
    private sealed class State(AmortizationRequest request)
    {
        private readonly bool _daily = request.AccrualMethod == AccrualMethod.DailySimple;
        private decimal _balance = Money.Round(request.StartingBalance);
        private decimal _unpaid = Money.Round(request.StartingUnpaidInterest);
        private decimal _cumulative = request.StartingCumulativeInterest;
        private DateOnly _accrualFrom = request.StartDate;
        private decimal _pendingAccrual;

        public List<ScheduleRow> Rows { get; } = [];
        public Shortfall? FirstShortfall { get; private set; }
        public decimal? FinalAdjustment { get; private set; }
        public DateOnly? CappedLumpSum { get; private set; }
        public bool PaidOff => _balance <= 0m && _unpaid <= 0m;

        /// <summary>Daily accrual: a principal-only payment posted between due dates.</summary>
        public void PostLumpSum(LumpSum lump)
        {
            var date = lump.Date > _accrualFrom ? lump.Date : _accrualFrom;
            _pendingAccrual += InterestAccrual.Daily(_balance, request.AprPercent, _accrualFrom, date, request.DayCountBasis);
            _accrualFrom = date;

            var amount = Money.Round(lump.Amount);
            var start = _balance;
            if (amount < _balance)
            {
                _balance -= amount;
                Rows.Add(new ScheduleRow(null, date, ScheduleRowKind.LumpSum, start, 0m, amount, amount, 0m, amount,
                    _balance, _cumulative, _unpaid, request.MarkEstimated));
                return;
            }

            // The lump sum exceeds the principal: post the interest accrued so far and pay the loan off.
            var interest = Money.Round(_pendingAccrual);
            _pendingAccrual = 0m;
            _cumulative += interest;
            var interestDue = _unpaid + interest;
            var applied = Math.Min(amount, _balance + interestDue);
            if (applied < amount)
            {
                CappedLumpSum ??= date;
            }

            var interestPaid = Math.Min(applied - _balance, interestDue);
            _unpaid = interestDue - interestPaid;
            _balance = 0m;
            Rows.Add(new ScheduleRow(null, date, ScheduleRowKind.LumpSum, start, 0m, applied, applied, interest, start,
                0m, _cumulative, _unpaid, request.MarkEstimated));
        }

        public void PostPayment(int number, DateOnly due, decimal regular, decimal recurringExtra, decimal lumpExtra)
        {
            decimal interest;
            if (_daily)
            {
                interest = Money.Round(_pendingAccrual +
                    InterestAccrual.Daily(_balance, request.AprPercent, _accrualFrom, due, request.DayCountBasis));
                _pendingAccrual = 0m;
                _accrualFrom = due;
            }
            else
            {
                interest = Money.Round(InterestAccrual.Periodic(_balance, request.AprPercent, request.Frequency));
            }

            _cumulative += interest;
            var start = _balance;
            var interestDue = _unpaid + interest;
            var owed = _balance + interestDue;

            var scheduled = regular;
            var recurring = recurringExtra;
            var lump = lumpExtra;
            if (scheduled >= owed)
            {
                // Final payment smaller than (or equal to) the regular payment.
                if (lump > 0m)
                {
                    CappedLumpSum ??= due;
                }

                scheduled = owed;
                recurring = 0m;
                lump = 0m;
            }
            else if (scheduled + recurring + lump >= owed)
            {
                var room = owed - scheduled;
                recurring = Math.Min(recurring, room);
                var lumpRoom = room - recurring;
                if (lump > lumpRoom)
                {
                    CappedLumpSum ??= due;
                }

                lump = Math.Min(lump, lumpRoom);
            }
            else if (number == request.ContractPaymentCount && owed - scheduled - recurring - lump <= regular)
            {
                // Final payment adjustment at maturity: fold a residual smaller than one payment into it.
                var residual = owed - scheduled - recurring - lump;
                FinalAdjustment = residual;
                scheduled += residual;
            }

            var extra = recurring + lump;
            var total = scheduled + extra;
            if (interest > 0m && start > 0m && total <= interest && FirstShortfall is null)
            {
                FirstShortfall = new Shortfall(due, interest, total);
            }

            var interestPaid = Math.Min(total, interestDue);
            _unpaid = interestDue - interestPaid;
            var principal = total - interestPaid;
            _balance -= principal;

            Rows.Add(new ScheduleRow(number, due, ScheduleRowKind.Payment, start, scheduled, extra, total, interest,
                principal, _balance, _cumulative, _unpaid, request.MarkEstimated)
            {
                RecurringExtra = recurring,
            });
        }
    }
}
