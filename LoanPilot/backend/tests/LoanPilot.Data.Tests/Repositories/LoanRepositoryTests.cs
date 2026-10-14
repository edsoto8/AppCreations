using LoanPilot.Core.Domain;
using LoanPilot.Data.Repositories;
using LoanPilot.Data.Tests.Support;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Tests.Repositories;

public sealed class LoanRepositoryTests
{
    [Fact]
    public void Insert_FullLoan_RoundTripsEveryField()
    {
        using var db = new TestDatabase();
        var input = Samples.FullLoan();

        var saved = db.Loans.Insert(input);
        var loaded = db.Loans.Get(saved.Id);

        Assert.True(saved.Id > 0);
        Samples.AssertSameLoan(saved, loaded);
        input.Id = saved.Id;
        input.CreatedAt = saved.CreatedAt;
        input.UpdatedAt = saved.UpdatedAt;
        Samples.AssertSameLoan(input, loaded);
    }

    [Fact]
    public void Insert_EveryEnumValue_IsAcceptedByTheSchemaAndRoundTrips()
    {
        using var db = new TestDatabase();

        foreach (var frequency in Enum.GetValues<PaymentFrequency>())
        {
            foreach (var accrual in Enum.GetValues<AccrualMethod>())
            {
                foreach (var basis in Enum.GetValues<DayCountBasis>())
                {
                    var loan = Samples.MinimalLoan();
                    loan.PaymentFrequency = frequency;
                    loan.AccrualMethod = accrual;
                    loan.DayCountBasis = basis;

                    var loaded = db.Loans.Get(db.Loans.Insert(loan).Id)!;

                    Assert.Equal(frequency, loaded.PaymentFrequency);
                    Assert.Equal(accrual, loaded.AccrualMethod);
                    Assert.Equal(basis, loaded.DayCountBasis);
                }
            }
        }
    }

    [Fact]
    public void Insert_MinimalLoan_RoundTripsNullsAndDefaults()
    {
        using var db = new TestDatabase();

        var saved = db.Loans.Insert(Samples.MinimalLoan());
        var loaded = db.Loans.Get(saved.Id)!;

        Samples.AssertSameLoan(saved, loaded);
        Assert.Null(loaded.VehicleMake);
        Assert.Null(loaded.VehicleYear);
        Assert.Null(loaded.DownPayment);
        Assert.Null(loaded.ScheduledPayment);
        Assert.Null(loaded.CurrentBalance);
        Assert.Null(loaded.BalanceAsOf);
        Assert.Null(loaded.PaymentsMade);
        Assert.Null(loaded.InterestPaidToDate);
        Assert.Null(loaded.VehicleValue);
        Assert.Null(loaded.Notes);
        Assert.Equal(PaymentFrequency.Monthly, loaded.PaymentFrequency);
        Assert.Equal(AccrualMethod.Monthly, loaded.AccrualMethod);
        Assert.Equal(DayCountBasis.Actual365, loaded.DayCountBasis);
        Assert.False(loaded.IsArchived);
    }

    [Fact]
    public void Insert_IgnoresCallerIdAndTimestamps_AndSetsFromClock()
    {
        using var db = new TestDatabase();
        var input = Samples.MinimalLoan();
        input.Id = 999;
        input.CreatedAt = new DateTime(1999, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        input.UpdatedAt = input.CreatedAt;

        var saved = db.Loans.Insert(input);

        Assert.NotEqual(999, saved.Id);
        Assert.True(saved.CreatedAt > new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        Assert.Equal(saved.CreatedAt, saved.UpdatedAt);
        Assert.Equal(999, input.Id);
    }

    [Fact]
    public void Insert_TwoLoans_GetDistinctIncreasingIds()
    {
        using var db = new TestDatabase();

        var first = db.AddLoan("A");
        var second = db.AddLoan("B");

        Assert.True(second.Id > first.Id);
    }

    [Fact]
    public void Insert_ViolatingNotNullConstraint_ThrowsPersistenceExceptionAndLogs()
    {
        using var db = new TestDatabase();
        var logger = new CapturingLogger<LoanRepository>();
        var repository = new LoanRepository(db.Database, logger, db.Time);
        var loan = Samples.MinimalLoan();
        loan.Name = null!;

        var ex = Assert.Throws<PersistenceException>(() => repository.Insert(loan));

        Assert.Contains("Could not save the loan", ex.Message);
        Assert.NotNull(ex.InnerException);
        Assert.Contains(logger.Entries, e => e.Level == LogLevel.Error);
        Assert.Equal(0, db.Count("loans"));
    }

    [Fact]
    public void Get_MissingId_ReturnsNull()
    {
        using var db = new TestDatabase();

        Assert.Null(db.Loans.Get(12345));
    }

    [Fact]
    public void Update_ReplacesEveryField_KeepsCreatedAtAndAdvancesUpdatedAt()
    {
        using var db = new TestDatabase();
        var original = db.Loans.Insert(Samples.FullLoan());
        var edited = Samples.FullLoan("Renamed");
        edited.Id = original.Id;
        edited.VehicleMake = "Honda";
        edited.OriginalAmount = 1234.5m;
        edited.PaymentFrequency = PaymentFrequency.Weekly;
        edited.AccrualMethod = AccrualMethod.Monthly;
        edited.DayCountBasis = DayCountBasis.Actual365;
        edited.CreatedAt = new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

        var updated = db.Loans.Update(edited);

        Assert.NotNull(updated);
        Assert.Equal(original.Id, updated.Id);
        Assert.Equal("Renamed", updated.Name);
        Assert.Equal("Honda", updated.VehicleMake);
        Assert.Equal(1234.5m, updated.OriginalAmount);
        Assert.Equal(PaymentFrequency.Weekly, updated.PaymentFrequency);
        Assert.Equal(original.CreatedAt, updated.CreatedAt);
        Assert.True(updated.UpdatedAt > original.UpdatedAt);
        Samples.AssertSameLoan(updated, db.Loans.Get(original.Id));
    }

    [Fact]
    public void Update_OptionalFieldsSetToNull_ClearsThem()
    {
        using var db = new TestDatabase();
        var original = db.Loans.Insert(Samples.FullLoan());
        var edited = Samples.MinimalLoan("Cleared");
        edited.Id = original.Id;

        var updated = db.Loans.Update(edited)!;

        Assert.Null(updated.DownPayment);
        Assert.Null(updated.CurrentBalance);
        Assert.Null(updated.BalanceAsOf);
        Assert.Null(updated.Notes);
        Assert.Null(updated.Lender);
    }

    [Fact]
    public void Update_DoesNotChangeArchivedFlag()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        db.Loans.SetArchived(loan.Id, true);
        var edited = Samples.MinimalLoan("Edited");
        edited.Id = loan.Id;
        edited.IsArchived = false;

        var updated = db.Loans.Update(edited)!;

        Assert.True(updated.IsArchived);
    }

    [Fact]
    public void Update_MissingId_ReturnsNullAndInsertsNothing()
    {
        using var db = new TestDatabase();
        var loan = Samples.MinimalLoan();
        loan.Id = 42;

        Assert.Null(db.Loans.Update(loan));
        Assert.Equal(0, db.Count("loans"));
    }

    [Fact]
    public void SetArchived_TogglesFlagAndTimestamp()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        var archived = db.Loans.SetArchived(loan.Id, true);
        var restored = db.Loans.SetArchived(loan.Id, false);

        Assert.True(archived!.IsArchived);
        Assert.True(archived.UpdatedAt > loan.UpdatedAt);
        Assert.Equal(loan.CreatedAt, archived.CreatedAt);
        Assert.False(restored!.IsArchived);
        Assert.False(db.Loans.Get(loan.Id)!.IsArchived);
    }

    [Fact]
    public void SetArchived_MissingId_ReturnsNull()
    {
        using var db = new TestDatabase();

        Assert.Null(db.Loans.SetArchived(77, true));
    }

    [Fact]
    public void List_OrdersActiveFirstThenByNameIgnoringCase()
    {
        using var db = new TestDatabase();
        var zed = db.AddLoan("zed");
        db.AddLoan("Alpha");
        var archivedAlpha = db.AddLoan("Aardvark");
        db.AddLoan("beta");
        db.Loans.SetArchived(archivedAlpha.Id, true);
        db.Loans.SetArchived(zed.Id, true);

        var all = db.Loans.List(includeArchived: true);

        Assert.Equal(["Alpha", "beta", "Aardvark", "zed"], all.Select(l => l.Name));
        Assert.Equal([false, false, true, true], all.Select(l => l.IsArchived));
    }

    [Fact]
    public void List_ExcludingArchived_ReturnsOnlyActiveLoans()
    {
        using var db = new TestDatabase();
        db.AddLoan("Active");
        var archived = db.AddLoan("Old");
        db.Loans.SetArchived(archived.Id, true);

        var active = db.Loans.List(includeArchived: false);

        Assert.Equal(["Active"], active.Select(l => l.Name));
    }

    [Fact]
    public void List_NoLoans_ReturnsEmpty()
    {
        using var db = new TestDatabase();

        Assert.Empty(db.Loans.List(true));
    }

    [Fact]
    public void Delete_RemovesLoanAndCascadesToEverythingBelowIt()
    {
        using var db = new TestDatabase();
        var doomed = db.AddLoan("Doomed");
        var survivor = db.AddLoan("Survivor");
        foreach (var loan in new[] { doomed, survivor })
        {
            db.Scenarios.Insert(Samples.RichScenario(loan.Id));
            db.Payments.InsertMany(loan.Id, [Samples.Payment(loan.Id, new DateOnly(2025, 3, 1)), Samples.Payment(loan.Id, new DateOnly(2025, 4, 1))]);
        }

        Assert.Equal(2, db.Count("scenarios"));
        Assert.Equal(6, db.Count("scenario_recurring_extras"));
        Assert.Equal(6, db.Count("scenario_lump_sums"));
        Assert.Equal(4, db.Count("payment_records"));

        var deleted = db.Loans.Delete(doomed.Id);

        Assert.True(deleted);
        Assert.Null(db.Loans.Get(doomed.Id));
        Assert.Equal(1, db.Count("loans"));
        Assert.Equal(1, db.Count("scenarios"));
        Assert.Equal(3, db.Count("scenario_recurring_extras"));
        Assert.Equal(3, db.Count("scenario_lump_sums"));
        Assert.Equal(2, db.Count("payment_records"));
        Assert.Single(db.Scenarios.ListForLoan(survivor.Id));
        Assert.Equal(2, db.Payments.ListForLoan(survivor.Id).Count);
    }

    [Fact]
    public void Delete_MissingId_ReturnsFalse()
    {
        using var db = new TestDatabase();
        db.AddLoan();

        Assert.False(db.Loans.Delete(999));
        Assert.Equal(1, db.Count("loans"));
    }

    [Fact]
    public void Data_SurvivesNewRepositoryOverSameFile()
    {
        using var db = new TestDatabase();
        var saved = db.Loans.Insert(Samples.FullLoan());

        var another = new LoanRepository(db.Database, new CapturingLogger<LoanRepository>());

        Samples.AssertSameLoan(saved, another.Get(saved.Id));
    }
}
