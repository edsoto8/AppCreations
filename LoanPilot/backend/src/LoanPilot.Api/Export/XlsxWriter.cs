using System.IO.Compression;
using System.Security;
using System.Text;

namespace LoanPilot.Api.Export;

/// <summary>Cell value kinds the writer understands. Text is written as an inline string (never a formula).</summary>
public abstract record XlsxCell
{
    public sealed record Text(string Value, bool Bold = false) : XlsxCell;
    public sealed record Money(decimal Value) : XlsxCell;
    public sealed record Number(decimal Value) : XlsxCell;
    public sealed record Percent(decimal Value) : XlsxCell;
    public sealed record Date(DateOnly Value) : XlsxCell;
    public sealed record Empty : XlsxCell;

    public static readonly XlsxCell Blank = new Empty();
}

public sealed record XlsxSheet(string Name, IReadOnlyList<string> Headers, IReadOnlyList<IReadOnlyList<XlsxCell>> Rows, IReadOnlyList<double> ColumnWidths);

/// <summary>
/// Minimal Office Open XML (SpreadsheetML) writer: bold header row, frozen header, number formats for
/// money, dates and percentages. Avoids a third-party dependency for a simple, well-defined format.
/// </summary>
public static class XlsxWriter
{
    // Style indexes in styles.xml cellXfs.
    private const int StyleDefault = 0, StyleHeader = 1, StyleMoney = 2, StyleDate = 3, StylePercent = 4, StyleBold = 5, StyleNumber = 6;

    public static byte[] Write(IReadOnlyList<XlsxSheet> sheets)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            Add(zip, "[Content_Types].xml", ContentTypes(sheets.Count));
            Add(zip, "_rels/.rels",
                """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""");
            Add(zip, "xl/workbook.xml", Workbook(sheets));
            Add(zip, "xl/_rels/workbook.xml.rels", WorkbookRels(sheets.Count));
            Add(zip, "xl/styles.xml", Styles);
            for (var i = 0; i < sheets.Count; i++)
            {
                Add(zip, $"xl/worksheets/sheet{i + 1}.xml", Sheet(sheets[i]));
            }
        }

        return stream.ToArray();
    }

    /// <summary>Excel sheet names: at most 31 characters, none of []:*?/\ and unique.</summary>
    public static string SafeSheetName(string name, ISet<string> used)
    {
        var cleaned = new string(name.Select(c => "[]:*?/\\".Contains(c) ? '-' : c).ToArray()).Trim('\'', ' ');
        if (cleaned.Length == 0)
        {
            cleaned = "Sheet";
        }

        cleaned = cleaned[..Math.Min(31, cleaned.Length)];
        var candidate = cleaned;
        for (var n = 2; !used.Add(candidate.ToUpperInvariant()); n++)
        {
            var suffix = $" ({n})";
            candidate = cleaned[..Math.Min(cleaned.Length, 31 - suffix.Length)] + suffix;
        }

        return candidate;
    }

    private static void Add(ZipArchive zip, string path, string content)
    {
        var entry = zip.CreateEntry(path, CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(content);
    }

    private static string ContentTypes(int count)
    {
        var sb = new StringBuilder("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>""");
        for (var i = 1; i <= count; i++)
        {
            sb.Append($"""<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>""");
        }

        return sb.Append("</Types>").ToString();
    }

    private static string Workbook(IReadOnlyList<XlsxSheet> sheets)
    {
        var sb = new StringBuilder("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>""");
        for (var i = 0; i < sheets.Count; i++)
        {
            sb.Append($"""<sheet name="{Escape(sheets[i].Name)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>""");
        }

        return sb.Append("</sheets></workbook>").ToString();
    }

    private static string WorkbookRels(int count)
    {
        var sb = new StringBuilder("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">""");
        for (var i = 1; i <= count; i++)
        {
            sb.Append($"""<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>""");
        }

        sb.Append($"""<Relationship Id="rId{count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>""");
        return sb.Append("</Relationships>").ToString();
    }

    private const string Styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/><numFmt numFmtId="166" formatCode="0.00&quot;%&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EAF6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>""";

    private static string Sheet(XlsxSheet sheet)
    {
        var sb = new StringBuilder("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">""");
        if (sheet.Headers.Count > 0)
        {
            sb.Append("""<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>""");
        }

        if (sheet.ColumnWidths.Count > 0)
        {
            sb.Append("<cols>");
            for (var i = 0; i < sheet.ColumnWidths.Count; i++)
            {
                sb.Append(System.FormattableString.Invariant($"""<col min="{i + 1}" max="{i + 1}" width="{sheet.ColumnWidths[i]:0.##}" customWidth="1"/>"""));
            }

            sb.Append("</cols>");
        }

        sb.Append("<sheetData>");
        var rowNumber = 1;
        if (sheet.Headers.Count > 0)
        {
            AppendRow(sb, rowNumber++, sheet.Headers.Select(h => (XlsxCell)new XlsxCell.Text(h)).ToList(), header: true);
        }

        foreach (var row in sheet.Rows)
        {
            AppendRow(sb, rowNumber++, row, header: false);
        }

        return sb.Append("</sheetData></worksheet>").ToString();
    }

    private static void AppendRow(StringBuilder sb, int number, IReadOnlyList<XlsxCell> cells, bool header)
    {
        sb.Append($"<row r=\"{number}\">");
        for (var c = 0; c < cells.Count; c++)
        {
            var reference = ColumnName(c) + number;
            switch (cells[c])
            {
                case XlsxCell.Text text:
                    var style = header ? StyleHeader : text.Bold ? StyleBold : StyleDefault;
                    sb.Append($"<c r=\"{reference}\" t=\"inlineStr\" s=\"{style}\"><is><t xml:space=\"preserve\">{Escape(text.Value)}</t></is></c>");
                    break;
                case XlsxCell.Money money:
                    sb.Append(System.FormattableString.Invariant($"<c r=\"{reference}\" s=\"{StyleMoney}\"><v>{money.Value}</v></c>"));
                    break;
                case XlsxCell.Number value:
                    sb.Append(System.FormattableString.Invariant($"<c r=\"{reference}\" s=\"{StyleNumber}\"><v>{value.Value}</v></c>"));
                    break;
                case XlsxCell.Percent percent:
                    sb.Append(System.FormattableString.Invariant($"<c r=\"{reference}\" s=\"{StylePercent}\"><v>{percent.Value}</v></c>"));
                    break;
                case XlsxCell.Date date:
                    // Excel serial date: days since 1899-12-30.
                    var serial = date.Value.DayNumber - new DateOnly(1899, 12, 30).DayNumber;
                    sb.Append($"<c r=\"{reference}\" s=\"{StyleDate}\"><v>{serial}</v></c>");
                    break;
            }
        }

        sb.Append("</row>");
    }

    private static string ColumnName(int index)
    {
        var name = "";
        for (var i = index + 1; i > 0; i = (i - 1) / 26)
        {
            name = (char)('A' + ((i - 1) % 26)) + name;
        }

        return name;
    }

    private static string Escape(string value)
    {
        // Strip characters XML 1.0 cannot represent, then escape.
        var filtered = new string(value.Where(ch => ch is '\t' or '\n' or '\r' || ch >= ' ').ToArray());
        return SecurityElement.Escape(filtered) ?? "";
    }
}
