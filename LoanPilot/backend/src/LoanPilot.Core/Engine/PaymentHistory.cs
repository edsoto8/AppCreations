using System.Globalization;
using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

public sealed record TrackingPoint(DateOnly Date, decimal ScheduledCumulative, decimal? ActualCumulative);

public sealed record TrackingResult(IReadOnlyList<TrackingPoint> Points, decimal TotalScheduled, decimal TotalActual, decimal Difference, string Note);

public sealed record ImportError(int Line, string Message);

public sealed record PaymentImport(IReadOnlyList<PaymentRecord> Records, IReadOnlyList<ImportError> Errors);

public static class PaymentHistory
{
    /// <summary>
    /// Actual-versus-projected tracking: cumulative amounts due under the original schedule compared
    /// with cumulative recorded payments, at each scheduled due date up to today (or the last record).
    /// </summary>
    public static TrackingResult Track(LoanAnalysis analysis, IReadOnlyList<PaymentRecord> records)
    {
        var f = analysis.Format;
        var ordered = records.OrderBy(r => r.Date).ToList();
        var end = ordered.Count > 0 && ordered[^1].Date > analysis.Today ? ordered[^1].Date : analysis.Today;
        var points = new List<TrackingPoint>();
        decimal scheduled = 0m;
        foreach (var row in analysis.OriginalSchedule.Rows)
        {
            if (row.Date > end)
            {
                break;
            }

            scheduled += row.TotalPayment;
            var actual = ordered.Count == 0 ? (decimal?)null : ordered.Where(r => r.Date <= row.Date).Sum(r => r.Amount);
            points.Add(new TrackingPoint(row.Date, scheduled, actual));
        }

        var totalActual = ordered.Where(r => r.Date <= end).Sum(r => r.Amount);
        var difference = totalActual - scheduled;
        string note;
        if (ordered.Count == 0)
        {
            note = "Add or import your payments to compare them with the original schedule.";
        }
        else if (difference >= 0m)
        {
            note = $"You have paid {f.Money(difference)} more than the original schedule called for by {f.LongDate(end)}.";
        }
        else
        {
            note = $"Recorded payments are {f.Money(-difference)} behind the original schedule as of {f.LongDate(end)}. " +
                "If you did not record every payment, the comparison will understate what you paid.";
        }

        return new TrackingResult(points, scheduled, totalActual, difference, note);
    }

    private static readonly string[] DateFormats =
        ["yyyy-MM-dd", "M/d/yyyy", "MM/dd/yyyy", "M/d/yy", "yyyy/MM/dd", "d-MMM-yyyy", "MMM d, yyyy"];

    /// <summary>
    /// Parses CSV with columns <c>date,amount[,principal,interest,note]</c>. A header row is optional.
    /// Amounts may include currency symbols and thousands separators. Lines with errors are reported and
    /// skipped; the rest are returned.
    /// </summary>
    public static PaymentImport ParseCsv(string csv, long loanId)
    {
        var records = new List<PaymentRecord>();
        var errors = new List<ImportError>();
        var lines = csv.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].Trim();
            var lineNumber = i + 1;
            if (line.Length == 0)
            {
                continue;
            }

            var fields = SplitCsvLine(line);
            if (i == 0 && fields.Count > 0 && fields[0].Trim().Equals("date", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (fields.Count < 2)
            {
                errors.Add(new ImportError(lineNumber, "Expected at least a date and an amount."));
                continue;
            }

            if (!DateOnly.TryParseExact(fields[0].Trim(), DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
            {
                errors.Add(new ImportError(lineNumber, $"\"{fields[0]}\" is not a date (use yyyy-mm-dd or mm/dd/yyyy)."));
                continue;
            }

            if (!TryParseMoney(fields[1], out var amount) || amount <= 0m)
            {
                errors.Add(new ImportError(lineNumber, $"\"{fields[1]}\" is not a positive amount."));
                continue;
            }

            decimal? principal = null, interest = null;
            if (fields.Count > 2 && fields[2].Trim().Length > 0)
            {
                if (!TryParseMoney(fields[2], out var p) || p < 0m)
                {
                    errors.Add(new ImportError(lineNumber, $"\"{fields[2]}\" is not a valid principal amount."));
                    continue;
                }

                principal = p;
            }

            if (fields.Count > 3 && fields[3].Trim().Length > 0)
            {
                if (!TryParseMoney(fields[3], out var p) || p < 0m)
                {
                    errors.Add(new ImportError(lineNumber, $"\"{fields[3]}\" is not a valid interest amount."));
                    continue;
                }

                interest = p;
            }

            if (principal + interest is { } split && Math.Abs(split - amount) > 0.01m)
            {
                errors.Add(new ImportError(lineNumber, "Principal plus interest does not add up to the amount."));
                continue;
            }

            var note = fields.Count > 4 ? string.Join(",", fields.Skip(4)).Trim() : null;
            records.Add(new PaymentRecord
            {
                LoanId = loanId,
                Date = date,
                Amount = Money.Round(amount),
                Principal = principal is { } pr ? Money.Round(pr) : null,
                Interest = interest is { } it ? Money.Round(it) : null,
                Note = string.IsNullOrEmpty(note) ? null : note[..Math.Min(note.Length, 200)],
            });
        }

        return new PaymentImport(records, errors);
    }

    public static IReadOnlyList<ValidationError> Validate(PaymentRecord record, Loan loan, DateOnly today)
    {
        var errors = new List<ValidationError>();
        if (record.Amount <= 0m || record.Amount > LoanValidator.MaxAmount)
        {
            errors.Add(new ValidationError("amount", "The payment amount must be greater than zero."));
        }

        if (record.Principal is < 0m)
        {
            errors.Add(new ValidationError("principal", "Principal cannot be negative."));
        }

        if (record.Interest is < 0m)
        {
            errors.Add(new ValidationError("interest", "Interest cannot be negative."));
        }

        if (record.Principal + record.Interest is { } split && Math.Abs(split - record.Amount) > 0.01m)
        {
            errors.Add(new ValidationError("principal", "Principal plus interest must add up to the payment amount."));
        }

        if (record.Date < loan.StartDate)
        {
            errors.Add(new ValidationError("date", "The payment date cannot be before the loan start date."));
        }
        else if (record.Date > today)
        {
            errors.Add(new ValidationError("date", "Record payments you have already made (the date cannot be in the future)."));
        }

        if (record.Note is { Length: > 200 })
        {
            errors.Add(new ValidationError("note", "The note can be at most 200 characters."));
        }

        return errors;
    }

    private static bool TryParseMoney(string text, out decimal value)
    {
        var cleaned = text.Trim().Replace("$", "").Replace("€", "").Replace("£", "").Replace(",", "").Trim();
        return decimal.TryParse(cleaned, NumberStyles.Number, CultureInfo.InvariantCulture, out value);
    }

    private static List<string> SplitCsvLine(string line)
    {
        var fields = new List<string>();
        var current = new System.Text.StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Append('"');
                    i++;
                }
                else if (c == '"')
                {
                    quoted = false;
                }
                else
                {
                    current.Append(c);
                }
            }
            else if (c == '"')
            {
                quoted = true;
            }
            else if (c == ',')
            {
                fields.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        fields.Add(current.ToString());
        return fields;
    }
}
