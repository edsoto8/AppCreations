using Microsoft.Data.Sqlite;

namespace LoanPilot.Data;

/// <summary>Location of the SQLite file and the single place connections are opened.</summary>
public sealed class LoanPilotDatabase
{
    public LoanPilotDatabase(string databasePath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);

        DatabasePath = Path.GetFullPath(databasePath);
        ConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            Pooling = true,
            DefaultTimeout = 5,
        }.ToString();
        DapperConfig.Register();
    }

    public string DatabasePath { get; }

    public string ConnectionString { get; }

    /// <summary>Opens a connection with <c>PRAGMA foreign_keys = ON</c> applied.</summary>
    public SqliteConnection Open()
    {
        var connection = new SqliteConnection(ConnectionString);
        try
        {
            connection.Open();
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }
}
