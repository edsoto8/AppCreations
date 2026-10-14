using LoanPilot.Core.Domain;
using LoanPilot.Data.Tests.Support;

namespace LoanPilot.Data.Tests.Repositories;

public sealed class ScenarioRepositoryTests
{
    [Fact]
    public void Insert_RichScenario_RoundTripsFieldsAndChildrenInOrder()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var input = Samples.RichScenario(loan.Id);

        var saved = db.Scenarios.Insert(input);
        var loaded = db.Scenarios.Get(loan.Id, saved.Id)!;

        Assert.True(saved.Id > 0);
        Assert.Equal(loan.Id, loaded.LoanId);
        Assert.Equal("Extra $100", loaded.Name);
        Assert.Equal("Pay more, earlier", loaded.Description);
        Assert.Equal(750.5m, loaded.BudgetPayment);
        Assert.Equal(input.RecurringExtras, loaded.RecurringExtras);
        Assert.Equal(input.LumpSums, loaded.LumpSums);
        Assert.Equal(saved.CreatedAt, loaded.CreatedAt);
        Assert.Equal(saved.UpdatedAt, loaded.UpdatedAt);
        Assert.Equal(saved.CreatedAt, saved.UpdatedAt);
    }

    [Fact]
    public void Insert_ScenarioWithoutOptionalData_RoundTripsNullsAndEmptyLists()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        var saved = db.Scenarios.Insert(new Scenario { LoanId = loan.Id, Name = "Empty" });
        var loaded = db.Scenarios.Get(loan.Id, saved.Id)!;

        Assert.Null(loaded.Description);
        Assert.Null(loaded.BudgetPayment);
        Assert.Empty(loaded.RecurringExtras);
        Assert.Empty(loaded.LumpSums);
        Assert.True(loaded.IsEmpty);
    }

    [Fact]
    public void Insert_ChildrenKeepListOrderEvenWhenNotChronological()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var scenario = new Scenario
        {
            LoanId = loan.Id,
            Name = "Order",
            LumpSums =
            [
                new LumpSum(3m, new DateOnly(2030, 1, 1)),
                new LumpSum(1m, new DateOnly(2026, 1, 1)),
                new LumpSum(2m, new DateOnly(2028, 1, 1)),
            ],
            RecurringExtras = [new RecurringExtra(9m), new RecurringExtra(1m), new RecurringExtra(5m)],
        };

        var loaded = db.Scenarios.Get(loan.Id, db.Scenarios.Insert(scenario).Id)!;

        Assert.Equal([3m, 1m, 2m], loaded.LumpSums.Select(l => l.Amount));
        Assert.Equal([9m, 1m, 5m], loaded.RecurringExtras.Select(e => e.Amount));
    }

    [Fact]
    public void Insert_ForMissingLoan_ThrowsPersistenceExceptionAndStoresNothing()
    {
        using var db = new TestDatabase();

        Assert.Throws<PersistenceException>(() => db.Scenarios.Insert(Samples.RichScenario(loanId: 404)));

        Assert.Equal(0, db.Count("scenarios"));
        Assert.Equal(0, db.Count("scenario_recurring_extras"));
        Assert.Equal(0, db.Count("scenario_lump_sums"));
    }

    [Fact]
    public void Insert_WhenAChildFails_RollsBackTheScenarioToo()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        db.Execute(
            """
            CREATE TRIGGER fail_boom BEFORE INSERT ON scenario_lump_sums
            WHEN NEW.note = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;
            """);
        var scenario = Samples.RichScenario(loan.Id);
        scenario.LumpSums.Add(new LumpSum(1m, new DateOnly(2030, 1, 1), "boom"));

        Assert.Throws<PersistenceException>(() => db.Scenarios.Insert(scenario));

        Assert.Equal(0, db.Count("scenarios"));
        Assert.Equal(0, db.Count("scenario_recurring_extras"));
        Assert.Equal(0, db.Count("scenario_lump_sums"));
    }

    [Fact]
    public void ListForLoan_ReturnsOnlyThatLoansScenariosOldestFirstWithChildren()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan("One");
        var other = db.AddLoan("Two");
        var first = db.Scenarios.Insert(Samples.RichScenario(loan.Id, "First"));
        db.Scenarios.Insert(Samples.RichScenario(other.Id, "Other loan"));
        var second = db.Scenarios.Insert(new Scenario
        {
            LoanId = loan.Id,
            Name = "Second",
            LumpSums = [new LumpSum(10m, new DateOnly(2027, 1, 1))],
        });

        var list = db.Scenarios.ListForLoan(loan.Id);

        Assert.Equal(["First", "Second"], list.Select(s => s.Name));
        Assert.Equal(first.Id, list[0].Id);
        Assert.Equal(3, list[0].RecurringExtras.Count);
        Assert.Equal(3, list[0].LumpSums.Count);
        Assert.Equal(second.Id, list[1].Id);
        Assert.Empty(list[1].RecurringExtras);
        Assert.Equal([new LumpSum(10m, new DateOnly(2027, 1, 1))], list[1].LumpSums);
    }

    [Fact]
    public void ListForLoan_NoScenarios_ReturnsEmpty()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        Assert.Empty(db.Scenarios.ListForLoan(loan.Id));
        Assert.Empty(db.Scenarios.ListForLoan(9999));
    }

    [Fact]
    public void Get_UnderTheWrongLoan_ReturnsNull()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan("One");
        var other = db.AddLoan("Two");
        var scenario = db.Scenarios.Insert(Samples.RichScenario(loan.Id));

        Assert.Null(db.Scenarios.Get(other.Id, scenario.Id));
        Assert.Null(db.Scenarios.Get(loan.Id, scenario.Id + 100));
    }

    [Fact]
    public void Update_ReplacesFieldsAndChildren_KeepsCreatedAtAndAdvancesUpdatedAt()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var original = db.Scenarios.Insert(Samples.RichScenario(loan.Id));
        var edited = new Scenario
        {
            Id = original.Id,
            LoanId = loan.Id,
            Name = "Renamed",
            Description = null,
            BudgetPayment = null,
            RecurringExtras = [new RecurringExtra(25m, null, new DateOnly(2027, 1, 1))],
            LumpSums =
            [
                new LumpSum(9m, new DateOnly(2029, 9, 9), "Last"),
                new LumpSum(8m, new DateOnly(2026, 8, 8)),
            ],
        };

        var updated = db.Scenarios.Update(edited);

        Assert.NotNull(updated);
        Assert.Equal("Renamed", updated.Name);
        Assert.Null(updated.Description);
        Assert.Null(updated.BudgetPayment);
        Assert.Equal(edited.RecurringExtras, updated.RecurringExtras);
        Assert.Equal(edited.LumpSums, updated.LumpSums);
        Assert.Equal(original.CreatedAt, updated.CreatedAt);
        Assert.True(updated.UpdatedAt > original.UpdatedAt);
        Assert.Equal(1, db.Count("scenario_recurring_extras"));
        Assert.Equal(2, db.Count("scenario_lump_sums"));
        Assert.Equal(1, db.Count("scenarios"));
    }

    [Fact]
    public void Update_ToEmptyChildLists_RemovesAllChildren()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var original = db.Scenarios.Insert(Samples.RichScenario(loan.Id));

        var updated = db.Scenarios.Update(new Scenario { Id = original.Id, LoanId = loan.Id, Name = "Bare" })!;

        Assert.Empty(updated.RecurringExtras);
        Assert.Empty(updated.LumpSums);
        Assert.Equal(0, db.Count("scenario_recurring_extras"));
        Assert.Equal(0, db.Count("scenario_lump_sums"));
    }

    [Fact]
    public void Update_MissingScenario_ReturnsNullAndWritesNothing()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();

        var result = db.Scenarios.Update(new Scenario
        {
            Id = 55,
            LoanId = loan.Id,
            Name = "Ghost",
            LumpSums = [new LumpSum(1m, new DateOnly(2030, 1, 1))],
        });

        Assert.Null(result);
        Assert.Equal(0, db.Count("scenarios"));
        Assert.Equal(0, db.Count("scenario_lump_sums"));
    }

    [Fact]
    public void Update_UnderTheWrongLoan_ReturnsNullAndLeavesScenarioUnchanged()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan("One");
        var other = db.AddLoan("Two");
        var original = db.Scenarios.Insert(Samples.RichScenario(loan.Id));

        var result = db.Scenarios.Update(new Scenario { Id = original.Id, LoanId = other.Id, Name = "Hijack" });

        Assert.Null(result);
        var unchanged = db.Scenarios.Get(loan.Id, original.Id)!;
        Assert.Equal(original.Name, unchanged.Name);
        Assert.Equal(original.UpdatedAt, unchanged.UpdatedAt);
        Assert.Equal(3, unchanged.RecurringExtras.Count);
        Assert.Equal(3, unchanged.LumpSums.Count);
    }

    [Fact]
    public void Update_WhenANewChildFails_RollsBackAndKeepsTheOldVersion()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var original = db.Scenarios.Insert(Samples.RichScenario(loan.Id));
        db.Execute(
            """
            CREATE TRIGGER fail_boom BEFORE INSERT ON scenario_lump_sums
            WHEN NEW.note = 'boom' BEGIN SELECT RAISE(ABORT, 'boom'); END;
            """);
        var edited = new Scenario
        {
            Id = original.Id,
            LoanId = loan.Id,
            Name = "Should not stick",
            RecurringExtras = [new RecurringExtra(1m)],
            LumpSums = [new LumpSum(1m, new DateOnly(2030, 1, 1)), new LumpSum(2m, new DateOnly(2030, 2, 1), "boom")],
        };

        Assert.Throws<PersistenceException>(() => db.Scenarios.Update(edited));

        var current = db.Scenarios.Get(loan.Id, original.Id)!;
        Assert.Equal(original.Name, current.Name);
        Assert.Equal(original.RecurringExtras, current.RecurringExtras);
        Assert.Equal(original.LumpSums, current.LumpSums);
    }

    [Fact]
    public void Delete_RemovesScenarioAndItsChildrenOnly()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var doomed = db.Scenarios.Insert(Samples.RichScenario(loan.Id, "Doomed"));
        db.Scenarios.Insert(Samples.RichScenario(loan.Id, "Keeper"));

        var deleted = db.Scenarios.Delete(loan.Id, doomed.Id);

        Assert.True(deleted);
        Assert.Equal(["Keeper"], db.Scenarios.ListForLoan(loan.Id).Select(s => s.Name));
        Assert.Equal(1, db.Count("scenarios"));
        Assert.Equal(3, db.Count("scenario_recurring_extras"));
        Assert.Equal(3, db.Count("scenario_lump_sums"));
    }

    [Fact]
    public void Delete_MissingOrWrongLoan_ReturnsFalseAndDeletesNothing()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan("One");
        var other = db.AddLoan("Two");
        var scenario = db.Scenarios.Insert(Samples.RichScenario(loan.Id));

        Assert.False(db.Scenarios.Delete(loan.Id, scenario.Id + 100));
        Assert.False(db.Scenarios.Delete(other.Id, scenario.Id));
        Assert.Equal(1, db.Count("scenarios"));
        Assert.Equal(3, db.Count("scenario_lump_sums"));
    }
}
