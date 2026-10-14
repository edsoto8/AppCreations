namespace LoanPilot.Core.Domain;

/// <summary>
/// A payoff strategy layered on top of a loan. A scenario never changes the loan itself.
/// </summary>
public sealed class Scenario
{
    public long Id { get; set; }
    public long LoanId { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }

    /// <summary>
    /// Optional total amount paid every period instead of the scheduled payment (budget-based payoff).
    /// Must be at least the scheduled payment; the difference is applied as extra principal.
    /// </summary>
    public decimal? BudgetPayment { get; set; }

    public List<RecurringExtra> RecurringExtras { get; set; } = [];
    public List<LumpSum> LumpSums { get; set; } = [];

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    public bool IsEmpty => BudgetPayment is null && RecurringExtras.Count == 0 && LumpSums.Count == 0;
}

/// <summary>
/// An extra principal amount added to every regular payment whose due date falls within
/// [<see cref="StartDate"/>, <see cref="EndDate"/>] (open-ended when null). Several entries can be
/// combined to model changing extra amounts over time; overlapping entries add up.
/// </summary>
public sealed record RecurringExtra(decimal Amount, DateOnly? StartDate = null, DateOnly? EndDate = null);

/// <summary>A one-time principal-only payment made on <see cref="Date"/>.</summary>
public sealed record LumpSum(decimal Amount, DateOnly Date, string? Note = null);
