namespace FileImporter.Core.Configuration;

/// <summary>Where files come from, how they are laid out, and where they go afterwards. Section "Import".</summary>
public sealed class ImportOptions
{
    public const string SectionName = "Import";

    /// <summary>Folder that is scanned for files to import.</summary>
    public string SourceDirectory { get; set; } = string.Empty;

    /// <summary>Search pattern for eligible files, e.g. "*.csv".</summary>
    public string FilePattern { get; set; } = "*.csv";

    /// <summary>Name of the archive subfolder created inside <see cref="SourceDirectory"/>.</summary>
    public string ArchiveFolderName { get; set; } = "Archive";

    /// <summary>Field delimiter for delimited files.</summary>
    public char Delimiter { get; set; } = ',';

    /// <summary>
    /// Text encoding of the files, e.g. "utf-8" or "windows-1252". A byte-order mark overrides it. With UTF-8, bytes
    /// that are not valid UTF-8 fail the file instead of being stored as replacement characters.
    /// </summary>
    public string Encoding { get; set; } = "utf-8";

    /// <summary>
    /// Accepted formats for columns of type Date (.NET custom format strings, invariant culture). Empty means
    /// <see cref="DefaultDateFormats"/>: ISO formats, which SQL Server converts the same way whatever the login's
    /// language or DATEFORMAT. If you add e.g. "MM/dd/yyyy", convert with an explicit style in the validation procedure.
    /// </summary>
    public List<string> DateFormats { get; set; } = [];

    public static IReadOnlyList<string> DefaultDateFormats { get; } = ["yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss", "yyyy-MM-ddTHH:mm:ss"];

    /// <summary>Files changed more recently than this are skipped until the next run, so half-copied files are not read.</summary>
    public int MinFileAgeSeconds { get; set; } = 30;

    /// <summary>A "Processing" import older than this is treated as abandoned (e.g. the app crashed) and may be retried.</summary>
    public int ProcessingTimeoutMinutes { get; set; } = 60;

    /// <summary>The expected file layout. The order is not important; columns are matched to the header by name.</summary>
    public List<ColumnMapping> Columns { get; set; } = [];
}

/// <summary>One column of the source file and the staging-table column it is loaded into.</summary>
public sealed class ColumnMapping
{
    /// <summary>Header name in the source file (case-insensitive).</summary>
    public string SourceName { get; set; } = string.Empty;

    /// <summary>Column in the staging table. Defaults to <see cref="SourceName"/>.</summary>
    public string? DestinationName { get; set; }

    /// <summary>When true, every row must have a non-blank value.</summary>
    public bool Required { get; set; }

    /// <summary>Optional format check done while reading the file. Values are still loaded as text.</summary>
    public ColumnType Type { get; set; } = ColumnType.Text;

    /// <summary>Optional maximum length of the value (0 = no limit).</summary>
    public int MaxLength { get; set; }

    public string Destination => string.IsNullOrWhiteSpace(DestinationName) ? SourceName : DestinationName;
}

public enum ColumnType
{
    Text,
    Integer,
    Decimal,
    Date,
}
