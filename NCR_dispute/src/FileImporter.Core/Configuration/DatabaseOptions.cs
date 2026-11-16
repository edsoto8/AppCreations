namespace FileImporter.Core.Configuration;

/// <summary>SQL Server settings. Section "Database". Keep the connection string out of appsettings.json in production.</summary>
public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>Set through the environment variable Database__ConnectionString or user secrets.</summary>
    public string ConnectionString { get; set; } = string.Empty;

    /// <summary>Staging table loaded with SqlBulkCopy, e.g. "dbo.NcrDisputeStaging".</summary>
    public string StagingTable { get; set; } = "dbo.NcrDisputeStaging";

    /// <summary>Staging column that receives the import id so rows can be traced back to their file.</summary>
    public string ImportIdColumn { get; set; } = "ImportId";

    /// <summary>Staging column that receives the data row number (1 = first row after the header). Empty = not loaded.</summary>
    public string? RowNumberColumn { get; set; } = "SourceRowNumber";

    /// <summary>Stored procedure run after the bulk load. It receives @ImportId and returns IsValid / Message.</summary>
    public string ValidationProcedure { get; set; } = "dbo.usp_ValidateNcrDisputeImport";

    public int BulkCopyBatchSize { get; set; } = 5000;

    public int BulkCopyTimeoutSeconds { get; set; } = 600;

    public int CommandTimeoutSeconds { get; set; } = 120;
}
