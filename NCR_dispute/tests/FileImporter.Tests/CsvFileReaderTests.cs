using System.Data;
using System.Text;
using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Tests.TestSupport;
using Microsoft.Extensions.Options;

namespace FileImporter.Tests;

public sealed class CsvFileReaderTests
{
    private static readonly ImportOptions Options = SampleData.Options();

    private static Core.Models.ImportFile Parse(string content, ImportOptions? options = null) =>
        CsvFileReader.Parse("test.csv", content, options ?? Options);

    [Fact]
    public void Parse_ValidFile_MapsColumnsByHeaderName()
    {
        using var file = Parse(SampleData.ValidCsv(rows: 2));

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal(2, file.RecordCount);
        Assert.Equal(["DisputeId", "AccountNumber", "TransactionDate", "Amount", "Notes"],
            file.Data.Columns.Cast<DataColumn>().Select(c => c.ColumnName));
        Assert.Equal("D-001", file.Data.Rows[0]["DisputeId"]);
        Assert.Equal("Row 2", file.Data.Rows[1]["Notes"]); // DestinationName mapping
    }

    [Fact]
    public void Parse_ColumnsInAnotherOrderWithExtraColumnsAndOtherCase_StillMaps()
    {
        using var file = Parse("amount,EXTRA,disputeid,TransactionDate,AccountNumber,Description\n10.00,x,D-1,2026-10-01,ACCT-1,hello\n");

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("10.00", file.Data.Rows[0]["Amount"]);
        Assert.Equal("D-1", file.Data.Rows[0]["DisputeId"]);
        Assert.Equal(5, file.Data.Columns.Count);
    }

    [Fact]
    public void Parse_QuotedFields_HandlesDelimitersQuotesAndLineBreaks()
    {
        var csv = SampleData.Header + "\r\n" +
                  "D-1,ACCT-1,2026-10-01,10.00,\"Comma, inside\"\r\n" +
                  "D-2,ACCT-2,2026-10-02,20.00,\"He said \"\"refund\"\"\"\r\n" +
                  "D-3,ACCT-3,2026-10-03,30.00,\"Line one\r\nLine two\"\r\n" +
                  "D-4,ACCT-4,2026-10-04,40.00,after multi-line\r\n";

        using var file = Parse(csv);

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal(4, file.RecordCount);
        Assert.Equal("Comma, inside", file.Data.Rows[0]["Notes"]);
        Assert.Equal("He said \"refund\"", file.Data.Rows[1]["Notes"]);
        Assert.Equal("Line one\r\nLine two", file.Data.Rows[2]["Notes"]);
        Assert.Equal("D-4", file.Data.Rows[3]["DisputeId"]);
    }

    [Fact]
    public void Parse_LineNumbersInErrors_CountLineBreaksInsideQuotes()
    {
        var csv = SampleData.Header + "\n" +
                  "D-1,ACCT-1,2026-10-01,10.00,\"two\nlines\"\n" +
                  "D-2,,2026-10-02,20.00,x\n";

        using var file = Parse(csv);

        Assert.Equal("Line 4, column 'AccountNumber': a value is required.", Assert.Single(file.Errors));
    }

    [Fact]
    public void Parse_BlankValuesAndWhitespace_AreTrimmedAndBlanksBecomeNull()
    {
        using var file = Parse(SampleData.Header + "\n  D-1 , ACCT-1 ,2026-10-01, 10.00 ,   \n");

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("D-1", file.Data.Rows[0]["DisputeId"]);
        Assert.Equal("10.00", file.Data.Rows[0]["Amount"]);
        Assert.Equal(DBNull.Value, file.Data.Rows[0]["Notes"]);
    }

    [Fact]
    public void Parse_BlankLines_AreSkipped()
    {
        using var file = Parse("\r\n" + SampleData.Header + "\r\n\r\nD-1,ACCT-1,2026-10-01,10.00,x\r\n\r\n\r\n");

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal(1, file.RecordCount);
    }

    [Fact]
    public void Parse_MissingColumn_ReportsItByName()
    {
        using var file = Parse("DisputeId,AccountNumber,Amount\nD-1,A,1\n");

        var error = Assert.Single(file.Errors);
        Assert.Contains("missing required columns: TransactionDate, Description", error);
    }

    [Fact]
    public void Parse_DuplicateHeader_IsAnError()
    {
        using var file = Parse(SampleData.Header + ",Amount\nD-1,A,2026-10-01,1,x,2\n");

        Assert.Contains(file.Errors, e => e.Contains("duplicate columns: Amount"));
    }

    [Fact]
    public void Parse_WrongFieldCount_IsAnErrorWithLineNumber()
    {
        using var file = Parse(SampleData.Header + "\nD-1,ACCT-1,2026-10-01,10.00\n");

        Assert.Equal("Line 2: expected 5 fields but found 4.", Assert.Single(file.Errors));
    }

    [Theory]
    [InlineData("D-1,ACCT-1,yesterday,10.00,x", "'yesterday' is not a valid date (expected yyyy-MM-dd or yyyy-MM-dd HH:mm:ss or yyyy-MM-ddTHH:mm:ss).")]
    [InlineData("D-1,ACCT-1,10:30,10.00,x", "'10:30' is not a valid date (expected yyyy-MM-dd or yyyy-MM-dd HH:mm:ss or yyyy-MM-ddTHH:mm:ss).")]
    [InlineData("D-1,ACCT-1,03/04/2026,10.00,x", "'03/04/2026' is not a valid date (expected yyyy-MM-dd or yyyy-MM-dd HH:mm:ss or yyyy-MM-ddTHH:mm:ss).")]
    [InlineData("D-1,ACCT-1,2026-10-01,ten,x", "'ten' is not a valid decimal.")]
    [InlineData("D-1,ACCT-1,2026-10-01,\"1,000.00\",x", "'1,000.00' is not a valid decimal.")]
    [InlineData(",ACCT-1,2026-10-01,10.00,x", "a value is required.")]
    public void Parse_InvalidValue_IsReported(string row, string expected)
    {
        using var file = Parse(SampleData.Header + "\n" + row + "\n");

        Assert.EndsWith(expected, Assert.Single(file.Errors));
    }

    [Fact]
    public void Parse_IntegerAndMaxLength_AreChecked()
    {
        var options = new ImportOptions
        {
            Columns =
            [
                new() { SourceName = "Id", Type = ColumnType.Integer },
                new() { SourceName = "Code", MaxLength = 3 },
            ],
        };

        using var file = Parse("Id,Code\n12,ABC\n1.5,ABCD\n", options);

        Assert.Equal(
            ["Line 3, column 'Id': '1.5' is not a valid integer.", "Line 3, column 'Code': value is 4 characters long; the maximum is 3."],
            file.Errors);
    }

    [Theory]
    [InlineData("")]
    [InlineData("\r\n\r\n")]
    public void Parse_EmptyFile_IsAnError(string content)
    {
        using var file = Parse(content);

        Assert.Equal("The file is empty.", Assert.Single(file.Errors));
    }

    [Fact]
    public void Parse_HeaderOnly_IsAnError()
    {
        using var file = Parse(SampleData.Header + "\r\n");

        Assert.Equal("The file has a header row but no data rows.", Assert.Single(file.Errors));
    }

    [Fact]
    public void Parse_UnclosedQuote_IsAnErrorNotAnException()
    {
        using var file = Parse(SampleData.Header + "\nD-1,ACCT-1,2026-10-01,10.00,\"never closed\n");

        Assert.Contains("Line 2: a quoted field is not closed", Assert.Single(file.Errors));
    }

    [Fact]
    public void Parse_ManyErrors_AreCapped()
    {
        var rows = Enumerable.Range(1, CsvFileReader.MaxErrors + 50).Select(i => $"D-{i},,2026-10-01,10.00,x");
        using var file = Parse(SampleData.Header + "\n" + string.Join("\n", rows));

        Assert.Equal(CsvFileReader.MaxErrors + 1, file.Errors.Count);
        Assert.Equal("... and 50 more errors.", file.Errors[^1]);
    }

    [Fact]
    public void Parse_ConfiguredDateFormat_IsAccepted()
    {
        var options = SampleData.Options();
        options.DateFormats = ["MM/dd/yyyy"];

        using var file = Parse(SampleData.Header + "\nD-1,ACCT-1,03/04/2026,10.00,x\n", options);

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
    }

    [Theory]
    [InlineData("\"He said \"hi\" there\"")]
    [InlineData("\"abc\"def")]
    public void Parse_TextAfterClosingQuote_IsAnError(string description)
    {
        using var file = Parse(SampleData.Header + "\nD-1,ACCT-1,2026-10-01,10.00," + description + "\n");

        Assert.Contains("after a closing quote", Assert.Single(file.Errors));
        Assert.Equal(0, file.RecordCount);
    }

    [Fact]
    public void Parse_SpacesAroundQuotedField_AreIgnored()
    {
        using var file = Parse(SampleData.Header + "\nD-1,ACCT-1,2026-10-01,10.00,  \"Comma, inside\"  \n");

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("Comma, inside", file.Data.Rows[0]["Notes"]);
    }

    [Fact]
    public void Parse_QuoteInsideUnquotedField_IsKeptAsText()
    {
        using var file = Parse(SampleData.Header + "\nD-1,ACCT-1,2026-10-01,10.00,5\" screen\n");

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("5\" screen", file.Data.Rows[0]["Notes"]);
    }

    [Fact]
    public void Read_InvalidUtf8_IsAnError()
    {
        var bytes = Encoding.Latin1.GetBytes(SampleData.ValidCsv(rows: 1).Replace("Row 1", "Müller"));

        using var file = new CsvFileReader(Microsoft.Extensions.Options.Options.Create(Options)).Read("ansi.csv", bytes, TestContext.Current.CancellationToken);

        Assert.StartsWith("The file is not valid utf-8 text", Assert.Single(file.Errors));
    }

    [Fact]
    public void Read_Windows1252Configured_DecodesCorrectly()
    {
        var options = SampleData.Options();
        options.Encoding = "windows-1252";
        var bytes = Encoding.Latin1.GetBytes(SampleData.ValidCsv(rows: 1).Replace("Row 1", "Müller"));

        using var file = new CsvFileReader(Microsoft.Extensions.Options.Options.Create(options)).Read("ansi.csv", bytes, TestContext.Current.CancellationToken);

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("Müller", file.Data.Rows[0]["Notes"]);
    }

    [Fact]
    public void Parse_OtherDelimiter_IsSupported()
    {
        var options = SampleData.Options();
        options.Delimiter = '|';

        using var file = Parse("DisputeId|AccountNumber|TransactionDate|Amount|Description\nD-1|A,B|2026-10-01|10.00|x\n", options);

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("A,B", file.Data.Rows[0]["AccountNumber"]);
    }

    [Fact]
    public void Read_Utf8WithBom_ReadsHeaderCorrectly()
    {
        var bytes = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true).GetPreamble()
            .Concat(Encoding.UTF8.GetBytes(SampleData.ValidCsv(rows: 1).Replace("Row 1", "Café"))).ToArray();
        var reader = new CsvFileReader(Microsoft.Extensions.Options.Options.Create(Options));

        using var file = reader.Read(Path.Combine("in", "bom.csv"), bytes, TestContext.Current.CancellationToken);

        Assert.True(file.IsValid, string.Join(Environment.NewLine, file.Errors));
        Assert.Equal("Café", file.Data.Rows[0]["Notes"]);
        Assert.Equal("bom.csv", file.FileName);
    }
}
