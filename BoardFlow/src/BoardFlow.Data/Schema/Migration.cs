namespace BoardFlow.Data.Schema;

/// <summary>One schema step. <see cref="Version"/> is written to <c>PRAGMA user_version</c> once applied.</summary>
public sealed record Migration(int Version, string Description, string Sql);
