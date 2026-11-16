using System.Text.RegularExpressions;
using Dapper;
using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Tests.TestSupport;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;

namespace FileImporter.Tests.SqlServer;

/// <summary>
/// Creates a throwaway database from the scripts in sql/ and drops it afterwards. Only active when the environment
/// variable FILEIMPORTER_TEST_SQL holds a connection string to a SQL Server where the login may create databases,
/// e.g. "Server=localhost,1433;User ID=sa;Password=...;TrustServerCertificate=True". Otherwise the tests are skipped.
/// </summary>
public sealed partial class SqlServerFixture : IAsyncLifetime
{
    public const string EnvironmentVariable = "FILEIMPORTER_TEST_SQL";

    private readonly string? _serverConnectionString = Environment.GetEnvironmentVariable(EnvironmentVariable);
    private readonly string _databaseName = "FileImporterTests_" + Guid.NewGuid().ToString("N")[..12];

    public bool IsAvailable => !string.IsNullOrWhiteSpace(_serverConnectionString);

    public string ConnectionString { get; private set; } = string.Empty;

    public async ValueTask InitializeAsync()
    {
        if (!IsAvailable)
        {
            return;
        }

        await using (var master = new SqlConnection(new SqlConnectionStringBuilder(_serverConnectionString) { InitialCatalog = "master" }.ConnectionString))
        {
            await master.ExecuteAsync($"CREATE DATABASE [{_databaseName}];");
        }

        ConnectionString = new SqlConnectionStringBuilder(_serverConnectionString) { InitialCatalog = _databaseName }.ConnectionString;
        await using var connection = new SqlConnection(ConnectionString);
        await connection.OpenAsync();
        foreach (var script in new[] { "01_FileImport.sql", "02_NcrDisputeStaging.sql", "03_usp_ValidateNcrDisputeImport.sql" })
        {
            var text = await File.ReadAllTextAsync(Path.Combine(RepoPaths.SqlFolder, script));
            foreach (var batch in GoSeparator().Split(text).Where(b => !string.IsNullOrWhiteSpace(b)))
            {
                await connection.ExecuteAsync(batch);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (!IsAvailable || ConnectionString.Length == 0)
        {
            return;
        }

        SqlConnection.ClearAllPools();
        await using var master = new SqlConnection(new SqlConnectionStringBuilder(_serverConnectionString) { InitialCatalog = "master" }.ConnectionString);
        await master.ExecuteAsync($"ALTER DATABASE [{_databaseName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_databaseName}];");
    }

    /// <summary>Same settings as appsettings.json, pointed at the test database.</summary>
    public DatabaseOptions DatabaseOptions(string? validationProcedure = null) => new()
    {
        ConnectionString = ConnectionString,
        ValidationProcedure = validationProcedure ?? "dbo.usp_ValidateNcrDisputeImport",
    };

    public SqlImportRepository Repository(string? validationProcedure = null) =>
        new(Options.Create(DatabaseOptions(validationProcedure)), Options.Create(NcrColumns.Options()));

    public SqlConnection Connect() => new(ConnectionString);

    [GeneratedRegex(@"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase)]
    private static partial Regex GoSeparator();
}

/// <summary>The placeholder NCR dispute layout from appsettings.json and sql/02_NcrDisputeStaging.sql.</summary>
public static class NcrColumns
{
    public static ImportOptions Options(string sourceDirectory = "") => new()
    {
        SourceDirectory = sourceDirectory,
        MinFileAgeSeconds = 0,
        Columns =
        [
            new() { SourceName = "DisputeId", Required = true, MaxLength = 50 },
            new() { SourceName = "AccountNumber", Required = true, MaxLength = 34 },
            new() { SourceName = "TransactionDate", Required = true, Type = ColumnType.Date },
            new() { SourceName = "Amount", Required = true, Type = ColumnType.Decimal },
            new() { SourceName = "CurrencyCode", Required = true, MaxLength = 3 },
            new() { SourceName = "ReasonCode", Required = true, MaxLength = 10 },
            new() { SourceName = "Description", MaxLength = 500 },
        ],
    };
}
