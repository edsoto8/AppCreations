using LoanPilot.Core.Domain;
using LoanPilot.Data.Repositories;
using LoanPilot.Data.Tests.Support;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Tests.Repositories;

public sealed class PreferencesRepositoryTests
{
    private static void Assert_Defaults(UserPreferences preferences)
    {
        Assert.Equal("system", preferences.Theme);
        Assert.Equal("USD", preferences.Currency);
        Assert.Equal(AccrualMethod.Monthly, preferences.DefaultAccrualMethod);
        Assert.Null(preferences.SelectedLoanId);
        Assert.Null(preferences.ComparisonBudget);
    }

    [Fact]
    public void Get_NothingStored_ReturnsDefaults()
    {
        using var db = new TestDatabase();

        Assert_Defaults(db.Preferences.Get());
    }

    [Fact]
    public void Save_ThenGet_RoundTripsEveryValue()
    {
        using var db = new TestDatabase();
        var loan = db.AddLoan();
        var input = new UserPreferences
        {
            Theme = "dark",
            Currency = "EUR",
            DefaultAccrualMethod = AccrualMethod.DailySimple,
            SelectedLoanId = loan.Id,
            ComparisonBudget = 1234.5600m,
        };

        db.Preferences.Save(input);
        var loaded = db.Preferences.Get();

        Assert.Equal("dark", loaded.Theme);
        Assert.Equal("EUR", loaded.Currency);
        Assert.Equal(AccrualMethod.DailySimple, loaded.DefaultAccrualMethod);
        Assert.Equal(loan.Id, loaded.SelectedLoanId);
        Assert.Equal(1234.56m, loaded.ComparisonBudget);
        Assert.Equal("DailySimple", db.Scalar<string>("SELECT value FROM preferences WHERE key = 'default_accrual_method'"));
    }

    [Fact]
    public void Save_Twice_OverwritesWithoutDuplicatingKeys()
    {
        using var db = new TestDatabase();
        db.Preferences.Save(new UserPreferences { Theme = "light", ComparisonBudget = 100m });

        db.Preferences.Save(new UserPreferences { Theme = "dark", ComparisonBudget = 200m });

        var loaded = db.Preferences.Get();
        Assert.Equal("dark", loaded.Theme);
        Assert.Equal(200m, loaded.ComparisonBudget);
        Assert.Equal(4, db.Count("preferences"));
    }

    [Fact]
    public void Save_NullOptionalValues_RemovesTheirKeys()
    {
        using var db = new TestDatabase();
        db.Preferences.Save(new UserPreferences { SelectedLoanId = 7, ComparisonBudget = 300m });

        db.Preferences.Save(new UserPreferences());

        var loaded = db.Preferences.Get();
        Assert.Null(loaded.SelectedLoanId);
        Assert.Null(loaded.ComparisonBudget);
        Assert.Equal(0, db.Scalar<long>("SELECT COUNT(*) FROM preferences WHERE key IN ('selected_loan_id', 'comparison_budget')"));
    }

    [Fact]
    public void Get_UnknownKeys_AreIgnored()
    {
        using var db = new TestDatabase();
        db.Preferences.Save(new UserPreferences { Theme = "light" });
        db.Execute("INSERT INTO preferences (key, value) VALUES ('from_the_future', 'whatever'), ('', '')");

        var loaded = db.Preferences.Get();

        Assert.Equal("light", loaded.Theme);
        Assert.Equal("USD", loaded.Currency);
    }

    [Fact]
    public void Get_GarbageValues_FallBackToDefaultsAndLogWarnings()
    {
        using var db = new TestDatabase();
        var logger = new CapturingLogger<PreferencesRepository>();
        var repository = new PreferencesRepository(db.Database, logger);
        db.Execute(
            """
            INSERT INTO preferences (key, value) VALUES
                ('theme', 'neon'),
                ('currency', '   '),
                ('default_accrual_method', '1'),
                ('selected_loan_id', 'abc'),
                ('comparison_budget', '12,5x')
            """);

        var loaded = repository.Get();

        Assert_Defaults(loaded);
        Assert.Equal(5, logger.Entries.Count(e => e.Level == LogLevel.Warning));
    }

    [Fact]
    public void Get_OneGarbageValue_DoesNotAffectTheOthers()
    {
        using var db = new TestDatabase();
        db.Preferences.Save(new UserPreferences { Theme = "dark", Currency = "GBP", ComparisonBudget = 50m });
        db.Execute("UPDATE preferences SET value = 'lots' WHERE key = 'comparison_budget'");

        var loaded = db.Preferences.Get();

        Assert.Equal("dark", loaded.Theme);
        Assert.Equal("GBP", loaded.Currency);
        Assert.Null(loaded.ComparisonBudget);
    }

    [Fact]
    public void Get_AccrualMethodWithWrongCase_FallsBackToDefault()
    {
        using var db = new TestDatabase();
        db.Execute("INSERT INTO preferences (key, value) VALUES ('default_accrual_method', 'dailysimple')");

        Assert.Equal(AccrualMethod.Monthly, db.Preferences.Get().DefaultAccrualMethod);
    }
}
