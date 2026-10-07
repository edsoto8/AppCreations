using Microsoft.Data.Sqlite;

namespace BoardFlow.Data;

/// <summary>Location of the SQLite file and the single place connections are opened.</summary>
public sealed class BoardFlowDatabase
{
    public BoardFlowDatabase(string databasePath)
    {
        DatabasePath = Path.GetFullPath(databasePath);
        ConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            Pooling = true,
            DefaultTimeout = 5,
        }.ToString();
        DapperConfig.Configure();
    }

    public string DatabasePath { get; }

    public string ConnectionString { get; }

    /// <summary>Opens a connection with foreign-key enforcement on.</summary>
    public SqliteConnection Open()
    {
        var connection = new SqliteConnection(ConnectionString);
        connection.Open();
        return connection;
    }
}
