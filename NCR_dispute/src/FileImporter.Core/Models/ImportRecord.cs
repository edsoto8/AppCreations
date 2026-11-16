namespace FileImporter.Core.Models;

/// <summary>A row of the tracking table.</summary>
public sealed record ImportRecord(Guid ImportId, string FileName, string FileHash, string Status, DateTime StartedAtUtc);

/// <summary>
/// Result of trying to start an import. <see cref="IsNew"/> is false when the same file content is already imported,
/// archive-pending or being processed; <see cref="Record"/> is then the existing record.
/// </summary>
public sealed record ImportClaim(ImportRecord Record, bool IsNew);
