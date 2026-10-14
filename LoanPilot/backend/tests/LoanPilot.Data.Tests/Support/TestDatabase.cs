using LoanPilot.Core.Domain;
using LoanPilot.Data.Repositories;
using LoanPilot.Data.Schema;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

namespace LoanPilot.Data.Tests.Support;

/// <summary>
/// A real SQLite file in a fresh temp folder, initialised with the production migrations, plus the
/// repositories over it.
/// </summary>
public sealed class TestDatabase : IDisposable
{
    private readonly TempDirectory _directory = new();

    public TestDatabase()
    {
        Database = new LoanPilotDatabase(_directory.DatabasePath);
        new DatabaseInitializer(Database, NullLogger<DatabaseInitializer>.Instance).Initialize();
        Loans = new LoanRepository(Database, NullLogger<LoanRepository>.Instance, Time);
        Scenarios = new ScenarioRepository(Database, NullLogger<ScenarioRepository>.Instance, Time);
        Payments = new PaymentRecordRepository(Database, NullLogger<PaymentRecordRepository>.Instance, Time);
        Preferences = new PreferencesRepository(Database, NullLogger<PreferencesRepository>.Instance);
    }

    public TestTimeProvider Time { get; } = new();

    public LoanPilotDatabase Database { get; }

    public LoanRepository Loans { get; }

    public ScenarioRepository Scenarios { get; }

    public PaymentRecordRepository Payments { get; }

    public PreferencesRepository Preferences { get; }

    /// <summary>Inserts a minimal loan and returns it.</summary>
    public Loan AddLoan(string name = "Civic") => Loans.Insert(Samples.MinimalLoan(name));

    /// <summary>Runs one scalar query on a fresh connection, for asserting on what is really stored.</summary>
    public T Scalar<T>(string sql, object? parameters = null)
    {
        using var connection = Database.Open();
        return Dapper.SqlMapper.ExecuteScalar<T>(connection, sql, parameters)!;
    }

    public long Count(string table) => Scalar<long>($"SELECT COUNT(*) FROM {table}");

    public void Execute(string sql)
    {
        using var connection = Database.Open();
        Dapper.SqlMapper.Execute(connection, sql);
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        _directory.Dispose();
    }
}
