namespace LoanPilot.Core.Domain;

/// <summary>App-wide preferences. Stored as key/value pairs; unknown keys are ignored.</summary>
public sealed class UserPreferences
{
    /// <summary>"system", "light" or "dark".</summary>
    public string Theme { get; set; } = "system";

    /// <summary>ISO 4217 code used for display formatting only.</summary>
    public string Currency { get; set; } = "USD";

    public AccrualMethod DefaultAccrualMethod { get; set; } = AccrualMethod.Monthly;

    public long? SelectedLoanId { get; set; }

    /// <summary>The monthly budget used by "best within budget" in scenario comparison.</summary>
    public decimal? ComparisonBudget { get; set; }
}
