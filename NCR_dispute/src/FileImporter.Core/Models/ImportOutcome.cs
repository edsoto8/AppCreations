namespace FileImporter.Core.Models;

public enum ImportResultKind
{
    /// <summary>Imported, validated and archived.</summary>
    Imported,

    /// <summary>Imported and validated, but the file could not be archived (status ArchivePending).</summary>
    ImportedArchivePending,

    /// <summary>Already imported earlier; the import was skipped and only the archive move was done or retried.</summary>
    AlreadyImported,

    /// <summary>Another run is processing the same file content right now; left untouched.</summary>
    InProgressElsewhere,

    /// <summary>Reading, loading or validation failed; the file was left in place.</summary>
    Failed,
}

/// <summary>Result of processing one file.</summary>
public sealed record ImportOutcome(
    string FileName,
    ImportResultKind Kind,
    Guid? ImportId,
    int RecordCount,
    TimeSpan Elapsed,
    string? Error = null)
{
    public bool IsFailure => Kind is ImportResultKind.Failed or ImportResultKind.ImportedArchivePending;
}

/// <summary>Result of one run over the source folder.</summary>
public sealed record ImportRunSummary(IReadOnlyList<ImportOutcome> Outcomes)
{
    public int FailureCount => Outcomes.Count(o => o.IsFailure);

    public bool Succeeded => FailureCount == 0;
}
