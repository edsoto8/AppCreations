using System.Globalization;
using Dapper;
using LoanPilot.Core.Domain;
using LoanPilot.Data.Tests.Support;

namespace LoanPilot.Data.Tests.Schema;

public sealed class DapperConfigTests
{
    [Theory]
    [InlineData("0.3")]
    [InlineData("12345678.91")]
    [InlineData("1234.5600")]
    [InlineData("0.0000001")]
    [InlineData("1234567890.123456789012345678")]
    [InlineData("79228162514264337593543950335")]
    [InlineData("-42.10")]
    public void Decimal_RoundTripsExactly(string text)
    {
        using var db = new TestDatabase();
        var value = decimal.Parse(text, CultureInfo.InvariantCulture);
        var loan = Samples.MinimalLoan();
        loan.OriginalAmount = value;
        loan.DownPayment = value;

        var saved = db.Loans.Insert(loan);
        var loaded = db.Loans.Get(saved.Id)!;

        Assert.Equal(value, loaded.OriginalAmount);
        Assert.Equal(value, loaded.DownPayment);
        Assert.Equal(text, db.Scalar<string>("SELECT original_amount FROM loans"));
    }

    [Fact]
    public void Decimal_SumOfBinaryFloatingPointTrap_IsExact()
    {
        using var db = new TestDatabase();
        var loan = Samples.MinimalLoan();
        loan.OriginalAmount = 0.1m + 0.2m;

        var loaded = db.Loans.Get(db.Loans.Insert(loan).Id)!;

        Assert.Equal(0.3m, loaded.OriginalAmount);
        Assert.Equal("0.3", db.Scalar<string>("SELECT original_amount FROM loans"));
    }

    [Fact]
    public void Decimal_IsStoredAsTextInEveryMoneyColumn()
    {
        using var db = new TestDatabase();
        db.Loans.Insert(Samples.FullLoan());

        foreach (var column in new[]
                 {
                     "original_amount", "down_payment", "apr_percent", "scheduled_payment",
                     "current_balance", "interest_paid_to_date", "vehicle_value",
                 })
        {
            Assert.Equal("text", db.Scalar<string>($"SELECT typeof({column}) FROM loans"));
        }
    }

    [Fact]
    public void Decimal_NullableNull_IsStoredAsSqlNull()
    {
        using var db = new TestDatabase();
        db.Loans.Insert(Samples.MinimalLoan());

        Assert.Equal("null", db.Scalar<string>("SELECT typeof(down_payment) FROM loans"));
        Assert.Null(db.Loans.List(true).Single().DownPayment);
    }

    [Fact]
    public void Decimal_WithNonInvariantCurrentCulture_StillUsesInvariantText()
    {
        using var db = new TestDatabase();
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            var loan = Samples.MinimalLoan();
            loan.OriginalAmount = 1234.56m;

            var loaded = db.Loans.Get(db.Loans.Insert(loan).Id)!;

            Assert.Equal(1234.56m, loaded.OriginalAmount);
            Assert.Equal("1234.56", db.Scalar<string>("SELECT original_amount FROM loans"));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void Decimal_AsPlainDapperParameter_UsesTheHandler()
    {
        using var db = new TestDatabase();
        using var connection = db.Database.Open();

        Assert.Equal("text", connection.ExecuteScalar<string>("SELECT typeof(@value)", new { value = 1.5m }));
        Assert.Equal("text", connection.ExecuteScalar<string>("SELECT typeof(@value)", new { value = (decimal?)1.5m }));
    }

    [Fact]
    public void DateOnly_IsStoredAsIsoText()
    {
        using var db = new TestDatabase();
        var loan = Samples.FullLoan();

        var loaded = db.Loans.Get(db.Loans.Insert(loan).Id)!;

        Assert.Equal(new DateOnly(2024, 2, 29), loaded.StartDate);
        Assert.Equal("2024-02-29", db.Scalar<string>("SELECT start_date FROM loans"));
        Assert.Equal("2026-02-01", db.Scalar<string>("SELECT balance_as_of FROM loans"));
    }

    [Fact]
    public void DateTime_IsStoredAsIsoUtcText()
    {
        using var db = new TestDatabase();

        var saved = db.AddLoan();

        var stored = db.Scalar<string>("SELECT created_at FROM loans");
        Assert.EndsWith("Z", stored);
        Assert.Equal(saved.CreatedAt, DateTime.Parse(stored, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));
        Assert.Equal(DateTimeKind.Utc, db.Loans.Get(saved.Id)!.CreatedAt.Kind);
    }

    [Fact]
    public void Enums_AreStoredAsReadableNames()
    {
        using var db = new TestDatabase();
        var saved = db.Loans.Insert(Samples.FullLoan());

        Assert.Equal("Biweekly", db.Scalar<string>("SELECT payment_frequency FROM loans"));
        Assert.Equal("DailySimple", db.Scalar<string>("SELECT accrual_method FROM loans"));
        Assert.Equal("ActualActual", db.Scalar<string>("SELECT day_count_basis FROM loans"));
        Assert.Equal(PaymentFrequency.Biweekly, saved.PaymentFrequency);
        Assert.Equal(AccrualMethod.DailySimple, saved.AccrualMethod);
        Assert.Equal(DayCountBasis.ActualActual, saved.DayCountBasis);
    }

    [Fact]
    public void Register_CalledRepeatedly_IsHarmless()
    {
        DapperConfig.Register();
        DapperConfig.Register();

        using var db = new TestDatabase();
        var loan = Samples.MinimalLoan();
        loan.OriginalAmount = 0.3m;

        Assert.Equal(0.3m, db.Loans.Get(db.Loans.Insert(loan).Id)!.OriginalAmount);
    }
}
