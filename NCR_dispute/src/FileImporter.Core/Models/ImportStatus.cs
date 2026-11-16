namespace FileImporter.Core.Models;

/// <summary>Status values stored in the tracking table (dbo.FileImport.Status).</summary>
public static class ImportStatus
{
    /// <summary>The import has started and has not finished yet.</summary>
    public const string Processing = "Processing";

    /// <summary>The data is in the staging table and passed validation. The file has been archived or will be on the next run.</summary>
    public const string Imported = "Imported";

    /// <summary>Reading, loading or validation failed. Nothing was committed and the file was left in place.</summary>
    public const string Failed = "Failed";

    /// <summary>The data was imported but the file could not be moved to the archive. The next run only retries the move.</summary>
    public const string ArchivePending = "ArchivePending";
}
