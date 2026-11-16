using FileImporter.Core.Configuration;

namespace FileImporter.Tests.TestSupport;

public static class SampleData
{
    public const string Header = "DisputeId,AccountNumber,TransactionDate,Amount,Description";

    public static string ValidCsv(int rows = 3, string idPrefix = "D")
    {
        var lines = new List<string> { Header };
        for (var i = 1; i <= rows; i++)
        {
            lines.Add($"{idPrefix}-{i:000},ACCT-{i:000},2026-10-{i % 28 + 1:00},{i * 10}.50,Row {i}");
        }

        return string.Join("\r\n", lines) + "\r\n";
    }

    public static ImportOptions Options(string sourceDirectory = "") => new()
    {
        SourceDirectory = sourceDirectory,
        FilePattern = "*.csv",
        ArchiveFolderName = "Archive",
        MinFileAgeSeconds = 0,
        Columns =
        [
            new() { SourceName = "DisputeId", Required = true, MaxLength = 50 },
            new() { SourceName = "AccountNumber", Required = true },
            new() { SourceName = "TransactionDate", Required = true, Type = ColumnType.Date },
            new() { SourceName = "Amount", Required = true, Type = ColumnType.Decimal },
            new() { SourceName = "Description", DestinationName = "Notes" },
        ],
    };
}
