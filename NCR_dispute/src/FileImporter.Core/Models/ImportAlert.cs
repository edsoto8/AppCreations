namespace FileImporter.Core.Models;

/// <summary>Details sent in a failure notification.</summary>
public sealed record ImportAlert(
    string FileName,
    Guid? ImportId,
    string Stage,
    string ErrorSummary,
    DateTimeOffset Timestamp);
