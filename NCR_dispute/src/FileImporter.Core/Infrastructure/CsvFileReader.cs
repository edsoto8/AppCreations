using System.Data;
using System.Globalization;
using System.Text;
using FileImporter.Core.Abstractions;
using FileImporter.Core.Configuration;
using FileImporter.Core.Models;
using Microsoft.Extensions.Options;

namespace FileImporter.Core.Infrastructure;

/// <summary>
/// Reads a delimited file with a header row (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes)
/// and maps its columns to the staging columns configured in <see cref="ImportOptions.Columns"/>.
/// Columns in the file that are not configured are ignored. Values are trimmed and blanks become NULL.
/// </summary>
public sealed class CsvFileReader(IOptions<ImportOptions> options) : IImportFileReader
{
    /// <summary>Stop collecting errors after this many; the file is rejected either way.</summary>
    internal const int MaxErrors = 100;

    public async Task<ImportFile> ReadAsync(string path, CancellationToken cancellationToken)
    {
        // The whole file is read up front; DataTable holds every row in memory anyway.
        string content;
        using (var reader = new StreamReader(path, Encoding.UTF8, detectEncodingFromByteOrderMarks: true))
        {
            content = await reader.ReadToEndAsync(cancellationToken).ConfigureAwait(false);
        }

        return Parse(path, content, options.Value, cancellationToken);
    }

    internal static ImportFile Parse(string path, string content, ImportOptions options, CancellationToken cancellationToken = default)
    {
        var columns = options.Columns;
        var table = new DataTable("Import");
        foreach (var column in columns)
        {
            table.Columns.Add(column.Destination, typeof(string));
        }

        var errors = new ErrorList();
        try
        {
            ReadRows(content, options, table, errors, cancellationToken);
        }
        catch (InvalidDataException ex)
        {
            errors.Add(ex.Message);
        }

        if (errors.Dropped > 0)
        {
            errors.Items.Add($"... and {errors.Dropped} more errors.");
        }

        return new ImportFile(path, table, errors.Items);
    }

    private static void ReadRows(string content, ImportOptions options, DataTable table, ErrorList errors, CancellationToken cancellationToken)
    {
        var columns = options.Columns;
        using var records = ReadRecords(content, options.Delimiter).GetEnumerator();

        if (!records.MoveNext())
        {
            errors.Add("The file is empty.");
            return;
        }

        var header = records.Current.Fields.Select(h => h.Trim()).ToArray();
        var positions = MapHeader(header, columns, errors);
        if (errors.Count > 0)
        {
            return;
        }

        while (records.MoveNext())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (line, fields) = records.Current;

            if (fields.Count != header.Length)
            {
                errors.Add($"Line {line}: expected {header.Length} fields but found {fields.Count}.");
                continue;
            }

            var row = table.NewRow();
            for (var i = 0; i < columns.Count; i++)
            {
                var value = fields[positions[i]].Trim();
                var problem = CheckValue(columns[i], value);
                if (problem is not null)
                {
                    errors.Add($"Line {line}, column '{columns[i].SourceName}': {problem}");
                }

                row[i] = value.Length == 0 ? DBNull.Value : value;
            }

            table.Rows.Add(row);
        }

        if (table.Rows.Count == 0 && errors.Count == 0)
        {
            errors.Add("The file has a header row but no data rows.");
        }
    }

    /// <summary>Returns, for each configured column, its position in the header.</summary>
    private static int[] MapHeader(string[] header, List<ColumnMapping> columns, ErrorList errors)
    {
        var duplicates = header.Where(h => h.Length > 0)
            .GroupBy(h => h, StringComparer.OrdinalIgnoreCase)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToList();
        if (duplicates.Count > 0)
        {
            errors.Add($"The header contains duplicate columns: {string.Join(", ", duplicates)}.");
        }

        var positions = new int[columns.Count];
        var missing = new List<string>();
        for (var i = 0; i < columns.Count; i++)
        {
            positions[i] = Array.FindIndex(header, h => string.Equals(h, columns[i].SourceName.Trim(), StringComparison.OrdinalIgnoreCase));
            if (positions[i] < 0)
            {
                missing.Add(columns[i].SourceName);
            }
        }

        if (missing.Count > 0)
        {
            errors.Add($"The header is missing required columns: {string.Join(", ", missing)}. Found: {string.Join(", ", header)}.");
        }

        return positions;
    }

    private static string? CheckValue(ColumnMapping column, string value)
    {
        if (value.Length == 0)
        {
            return column.Required ? "a value is required." : null;
        }

        if (column.MaxLength > 0 && value.Length > column.MaxLength)
        {
            return $"value is {value.Length} characters long; the maximum is {column.MaxLength}.";
        }

        var valid = column.Type switch
        {
            ColumnType.Integer => long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _),
            ColumnType.Decimal => decimal.TryParse(value, NumberStyles.AllowLeadingSign | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _),
            ColumnType.Date => DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out _),
            _ => true,
        };

        return valid ? null : $"'{Shorten(value)}' is not a valid {column.Type.ToString().ToLowerInvariant()}.";
    }

    private static string Shorten(string value) => value.Length <= 50 ? value : value[..50] + "...";

    /// <summary>Splits the content into records. Blank lines are skipped. Line numbers are 1-based and point at the start of the record.</summary>
    internal static IEnumerable<(int Line, List<string> Fields)> ReadRecords(string content, char delimiter)
    {
        var fields = new List<string>();
        var field = new StringBuilder();
        var inQuotes = false;
        var line = 1;
        var recordLine = 1;
        var i = 0;

        while (i < content.Length)
        {
            var c = content[i];

            if (inQuotes)
            {
                if (c == '"')
                {
                    if (i + 1 < content.Length && content[i + 1] == '"')
                    {
                        field.Append('"');
                        i += 2;
                        continue;
                    }

                    inQuotes = false;
                }
                else
                {
                    if (c == '\n')
                    {
                        line++;
                    }

                    field.Append(c);
                }

                i++;
                continue;
            }

            if (c == '"' && field.Length == 0)
            {
                inQuotes = true;
            }
            else if (c == delimiter)
            {
                fields.Add(field.ToString());
                field.Clear();
            }
            else if (c is '\r' or '\n')
            {
                if (c == '\r' && i + 1 < content.Length && content[i + 1] == '\n')
                {
                    i++;
                }

                fields.Add(field.ToString());
                field.Clear();
                if (!IsBlank(fields))
                {
                    yield return (recordLine, fields);
                }

                fields = [];
                line++;
                recordLine = line;
            }
            else
            {
                field.Append(c);
            }

            i++;
        }

        if (inQuotes)
        {
            throw new InvalidDataException($"Line {recordLine}: a quoted field is not closed before the end of the file.");
        }

        fields.Add(field.ToString());
        if (!IsBlank(fields))
        {
            yield return (recordLine, fields);
        }
    }

    private static bool IsBlank(List<string> fields) => fields.Count == 1 && string.IsNullOrWhiteSpace(fields[0]);

    private sealed class ErrorList
    {
        public List<string> Items { get; } = [];

        public int Dropped { get; private set; }

        public int Count => Items.Count + Dropped;

        public void Add(string error)
        {
            if (Items.Count < MaxErrors)
            {
                Items.Add(error);
            }
            else
            {
                Dropped++;
            }
        }
    }
}
