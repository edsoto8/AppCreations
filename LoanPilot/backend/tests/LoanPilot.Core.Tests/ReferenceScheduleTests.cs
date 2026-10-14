using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Core.Tests;

/// <summary>
/// Expected values come from tools/reference_amortization.py, an independent exact-rational
/// implementation, and (for the standard payment) published amortization tables.
/// </summary>
public sealed class ReferenceScheduleTests
{
    [Fact]
    public void StandardLoan_25kAt6PercentFor60Months_MatchesReference()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan));

        Assert.Equal(483.32m, projection.Rows[0].TotalPayment);
        Assert.Equal(125.00m, projection.Rows[0].Interest);
        Assert.Equal(358.32m, projection.Rows[0].Principal);
        Assert.Equal(60, projection.Summary.PaymentCount);
        Assert.Equal(3999.23m, projection.Summary.TotalInterest);
        Assert.Equal(28999.23m, projection.Summary.TotalPaid);
        Assert.Equal(483.35m, projection.Summary.FinalPayment);
        Assert.Equal(new DateOnly(2029, 1, 1), projection.Summary.PayoffDate);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void ZeroPercentLoan_FinalPaymentAbsorbsRounding()
    {
        var loan = TestLoans.Standard(20_000m, 0m, 48);
        var projection = AmortizationEngine.Run(TestLoans.Request(loan));

        Assert.Equal(416.67m, projection.Rows[0].TotalPayment);
        Assert.All(projection.Rows, r => Assert.Equal(0m, r.Interest));
        Assert.Equal(48, projection.Summary.PaymentCount);
        Assert.Equal(416.51m, projection.Summary.FinalPayment);
        Assert.Equal(20_000m, projection.Summary.TotalPaid);
        Assert.Equal(new DateOnly(2028, 1, 1), projection.Summary.PayoffDate);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void ExtraMonthlyPayment_PaysOffEarlierAndMatchesReference()
    {
        var loan = TestLoans.Standard(32_500m, 7.24m, 72, new DateOnly(2024, 12, 15), new DateOnly(2025, 1, 15));
        var baseline = AmortizationEngine.Run(TestLoans.Request(loan));
        var extra = AmortizationEngine.Run(TestLoans.Request(loan) with { RecurringExtras = [new RecurringExtra(100m)] });

        Assert.Equal(557.85m, baseline.Rows[0].ScheduledPayment);
        Assert.Equal(72, baseline.Summary.PaymentCount);
        Assert.Equal(7664.81m, baseline.Summary.TotalInterest);
        Assert.Equal(557.46m, baseline.Summary.FinalPayment);

        Assert.Equal(59, extra.Summary.PaymentCount);
        Assert.Equal(6206.25m, extra.Summary.TotalInterest);
        Assert.Equal(550.95m, extra.Summary.FinalPayment);
        Assert.Equal(new DateOnly(2029, 11, 15), extra.Summary.PayoffDate);
        Assert.Equal(461.77m, extra.Rows[0].Principal);
        TestLoans.AssertConsistent(extra);
    }

    [Fact]
    public void DailySimpleActual365_AcrossLeapYear_MatchesReference()
    {
        var loan = TestLoans.Standard(15_000m, 5.9m, 36, new DateOnly(2024, 1, 15), new DateOnly(2024, 2, 15));
        loan.AccrualMethod = AccrualMethod.DailySimple;
        var projection = AmortizationEngine.Run(TestLoans.Request(loan));

        Assert.Equal(455.65m, projection.Rows[0].ScheduledPayment);
        Assert.Equal(75.16m, projection.Rows[0].Interest); // 15000 × 5.9% × 31 / 365
        Assert.Equal(36, projection.Summary.PaymentCount);
        Assert.Equal(1403.89m, projection.Summary.TotalInterest);
        Assert.Equal(456.14m, projection.Summary.FinalPayment);
        Assert.Equal(new DateOnly(2027, 1, 15), projection.Summary.PayoffDate);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void DailySimpleActualActual_UsesLeapYearDayCount()
    {
        var loan = TestLoans.Standard(15_000m, 5.9m, 36, new DateOnly(2024, 1, 15), new DateOnly(2024, 2, 15));
        loan.AccrualMethod = AccrualMethod.DailySimple;
        loan.DayCountBasis = DayCountBasis.ActualActual;
        var projection = AmortizationEngine.Run(TestLoans.Request(loan));

        Assert.Equal(74.96m, projection.Rows[0].Interest); // 15000 × 5.9% × 31 / 366
        Assert.Equal(1401.58m, projection.Summary.TotalInterest);
        Assert.Equal(453.83m, projection.Summary.FinalPayment);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void LumpSum_MonthlyAccrual_CreditedWithNextPayment()
    {
        var loan = TestLoans.Standard();
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with
        {
            LumpSums = [new LumpSum(2000m, new DateOnly(2025, 1, 10))],
        });

        var credited = projection.Rows.Single(r => r.Date == new DateOnly(2025, 2, 1));
        Assert.Equal(2000m, credited.ExtraPayment);
        Assert.Equal(55, projection.Summary.PaymentCount);
        Assert.Equal(3497.34m, projection.Summary.TotalInterest);
        Assert.Equal(398.06m, projection.Summary.FinalPayment);
        Assert.Equal(new DateOnly(2028, 8, 1), projection.Summary.PayoffDate);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void LumpSum_DailyAccrual_PostsOnItsOwnDate()
    {
        var loan = TestLoans.Standard(15_000m, 5.9m, 36, new DateOnly(2024, 1, 15), new DateOnly(2024, 2, 15));
        loan.AccrualMethod = AccrualMethod.DailySimple;
        var projection = AmortizationEngine.Run(TestLoans.Request(loan) with
        {
            LumpSums = [new LumpSum(1500m, new DateOnly(2024, 6, 1))],
        });

        var lumpRow = Assert.Single(projection.Rows, r => r.Kind == ScheduleRowKind.LumpSum);
        Assert.Equal(new DateOnly(2024, 6, 1), lumpRow.Date);
        Assert.Null(lumpRow.Number);
        Assert.Equal(1500m, lumpRow.Principal);
        Assert.Equal(33, projection.Summary.PaymentCount);
        Assert.Equal(1165.64m, projection.Summary.TotalInterest);
        Assert.Equal(84.84m, projection.Summary.FinalPayment);
        Assert.Equal(new DateOnly(2026, 10, 15), projection.Summary.PayoffDate);
        TestLoans.AssertConsistent(projection);
    }

    [Fact]
    public void MonthEndFirstPayment_ClampsAndRestoresDayOfMonth()
    {
        var loan = TestLoans.Standard(18_000m, 4.5m, 60, new DateOnly(2023, 12, 31), new DateOnly(2024, 1, 31));
        var projection = AmortizationEngine.Run(TestLoans.Request(loan));

        Assert.Equal(
            [new DateOnly(2024, 1, 31), new DateOnly(2024, 2, 29), new DateOnly(2024, 3, 31), new DateOnly(2024, 4, 30)],
            projection.Rows.Take(4).Select(r => r.Date));
        Assert.Equal(335.57m, projection.Rows[0].ScheduledPayment);
        Assert.Equal(2134.48m, projection.Summary.TotalInterest);
        Assert.Equal(335.85m, projection.Summary.FinalPayment);
        Assert.Equal(new DateOnly(2028, 12, 31), projection.Summary.PayoffDate);
    }
}
