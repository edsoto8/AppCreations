using System.Globalization;
using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;
using LoanPilot.Data.Repositories;

namespace LoanPilot.Api;

/// <summary>
/// Loads what the engine needs for one request: the loan, its payment records, the display format
/// and "today" (the local date, or the <c>?asOf=yyyy-MM-dd</c> override).
/// </summary>
public sealed class LoanWorkspace(
    LoanRepository loans,
    ScenarioRepository scenarios,
    PaymentRecordRepository payments,
    PreferencesRepository preferences,
    TimeProvider time,
    IHttpContextAccessor http)
{
    public LoanRepository Loans => loans;
    public ScenarioRepository Scenarios => scenarios;
    public PaymentRecordRepository Payments => payments;
    public PreferencesRepository Preferences => preferences;

    public DateOnly Today
    {
        get
        {
            var asOf = http.HttpContext?.Request.Query["asOf"].ToString();
            if (!string.IsNullOrEmpty(asOf))
            {
                if (DateOnly.TryParseExact(asOf, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
                {
                    return parsed;
                }

                throw new LoanValidationException([new ValidationError("asOf", "Use the format yyyy-mm-dd for asOf.")]);
            }

            return DateOnly.FromDateTime(time.GetLocalNow().DateTime);
        }
    }

    public DisplayFormat Format => DisplayFormat.ForCurrency(preferences.Get().Currency);

    /// <summary>Analyzes a saved loan, or returns null when it does not exist.</summary>
    public LoanAnalysis? Analyze(long loanId)
    {
        var loan = loans.Get(loanId);
        return loan is null ? null : Analyze(loan);
    }

    public LoanAnalysis Analyze(Loan loan) =>
        LoanAnalyzer.Analyze(loan, Today, loan.Id == 0 ? [] : payments.ListForLoan(loan.Id), Format);
}
