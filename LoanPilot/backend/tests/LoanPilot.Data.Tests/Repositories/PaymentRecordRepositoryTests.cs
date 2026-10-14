using LoanPilot.Core.Domain;
using LoanPilot.Data.Tests.Support;

namespace LoanPilot.Data.Tests.Repositories;

public sealed class PaymentRecordRepositoryTests
{
    private static readonly DateOnly March = new(2025, 3, 1);

    [Fact]
    public void Insert_FullRecord_RoundTripsEveryField()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var input = new PaymentRecord
        {
            LoanId = loan.Id,
            Date = new DateOnly(2025, 3, 14),
            Amount = 512.3456m,
            Principal = 400.1m,
            Interest = 112.2456m,
            Note = "March; \"quoted\"",
        };

        var saved = db.Payments.Insert(input);
        var loaded = Assert.Single(db.Payments.ListForLoan(loan.Id));

        Assert.True(saved.Id > 0);
        Assert.Equal(saved.Id, loaded.Id);
        Assert.Equal(loan.Id, loaded.LoanId);
        Assert.Equal(input.Date, loaded.Date);
        Assert.Equal(512.3456m, loaded.Amount);
        Assert.Equal(400.1m, loaded.Principal);
        Assert.Equal(112.2456m, loaded.Interest);
        Assert.Equal(input.Note, loaded.Note);
        Assert.Equal(saved.CreatedAt, loaded.CreatedAt);
        Assert.Equal("text", db.Scalar<string>("SELECT typeof(amount) FROM payment_records"));
    }

    [Fact]
    public void Insert_OnlyRequiredFields_RoundTripsNulls()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        db.Payments.Insert(Samples.Payment(loan.Id, March));
        var loaded = Assert.Single(db.Payments.ListForLoan(loan.Id));

        Assert.Null(loaded.Principal);
        Assert.Null(loaded.Interest);
        Assert.Null(loaded.Note);
    }

    [Fact]
    public void Insert_ForMissingLoan_ThrowsPersistenceException()
    {
        using var db = new TestDatabase();

        Assert.Throws<PersistenceException>(() => db.Payments.Insert(Samples.Payment(404, March)));

        Assert.Equal(0, db.Count("payment_records"));
    }

    [Fact]
    public void ListForLoan_OrdersByDateThenInsertionOrder_AndScopesToTheLoan()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan("One");
        var other = db.AddLoan("Two");
        db.Payments.Insert(Samples.Payment(loan.Id, new DateOnly(2025, 5, 1), 3m));
        db.Payments.Insert(Samples.Payment(loan.Id, new DateOnly(2025, 3, 1), 1m, "first on the day"));
        db.Payments.Insert(Samples.Payment(other.Id, new DateOnly(2025, 1, 1), 99m));
        db.Payments.Insert(Samples.Payment(loan.Id, new DateOnly(2025, 3, 1), 2m, "second on the day"));

        var list = db.Payments.ListForLoan(loan.Id);

        Assert.Equal([1m, 2m, 3m], list.Select(p => p.Amount));
    }

    [Fact]
    public void ListForLoan_NoPayments_ReturnsEmpty()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        Assert.Empty(db.Payments.ListForLoan(loan.Id));
    }

    [Fact]
    public void InsertMany_StoresAllInOneCallAndReturnsThemWithIds()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var records = new[]
        {
            Samples.Payment(0, new DateOnly(2025, 4, 1), 100m, "a"),
            Samples.Payment(0, new DateOnly(2025, 3, 1), 200m, "b"),
            Samples.Payment(0, new DateOnly(2025, 5, 1), 300m, "c"),
        };

        var saved = db.Payments.InsertMany(loan.Id, records);

        Assert.Equal(3, saved.Count);
        Assert.Equal(3, saved.Select(p => p.Id).Distinct().Count());
        Assert.All(saved, p => Assert.Equal(loan.Id, p.LoanId));
        Assert.Equal(["b", "a", "c"], db.Payments.ListForLoan(loan.Id).Select(p => p.Note));
    }

    [Fact]
    public void InsertMany_EmptyList_ReturnsEmptyAndWritesNothing()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        Assert.Empty(db.Payments.InsertMany(loan.Id, []));
        Assert.Equal(0, db.Count("payment_records"));
    }

    [Fact]
    public void InsertMany_ForMissingLoan_ThrowsAndInsertsNothing()
    {
        using var db = new TestDatabase();
        var records = new[] { Samples.Payment(0, March), Samples.Payment(0, March.AddMonths(1)) };

        Assert.Throws<PersistenceException>(() => db.Payments.InsertMany(404, records));

        Assert.Equal(0, db.Count("payment_records"));
    }

    [Fact]
    public void InsertMany_WhenALaterRowFails_RollsBackTheEarlierRows()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        db.Payments.Insert(Samples.Payment(loan.Id, March, 1m, "already there"));
        db.Execute(
            """
            CREATE TRIGGER fail_boom BEFORE INSERT ON payment_records
            WHEN NEW.note = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;
            """);
        var records = new[]
        {
            Samples.Payment(0, March.AddMonths(1), 10m, "ok 1"),
            Samples.Payment(0, March.AddMonths(2), 20m, "ok 2"),
            Samples.Payment(0, March.AddMonths(3), 30m, "boom"),
            Samples.Payment(0, March.AddMonths(4), 40m, "never reached"),
        };

        var ex = Assert.Throws<PersistenceException>(() => db.Payments.InsertMany(loan.Id, records));

        Assert.Contains("Could not save the payments", ex.Message);
        Assert.Equal(["already there"], db.Payments.ListForLoan(loan.Id).Select(p => p.Note));
    }

    [Fact]
    public void Delete_RemovesOnlyThatPayment()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var keep = db.Payments.Insert(Samples.Payment(loan.Id, March, 1m));
        var drop = db.Payments.Insert(Samples.Payment(loan.Id, March, 2m));

        var deleted = db.Payments.Delete(loan.Id, drop.Id);

        Assert.True(deleted);
        Assert.Equal([keep.Id], db.Payments.ListForLoan(loan.Id).Select(p => p.Id));
    }

    [Fact]
    public void Delete_MissingOrWrongLoan_ReturnsFalseAndDeletesNothing()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan("One");
        var other = db.AddLoan("Two");
        var payment = db.Payments.Insert(Samples.Payment(loan.Id, March));

        Assert.False(db.Payments.Delete(loan.Id, payment.Id + 100));
        Assert.False(db.Payments.Delete(other.Id, payment.Id));
        Assert.Equal(1, db.Count("payment_records"));
    }
}
