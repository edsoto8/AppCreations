using BoardFlow.Core.Domain;

namespace BoardFlow.Core.Rules;

/// <summary>Which due dates a <see cref="CardFilter"/> lets through.</summary>
public enum DueFilter
{
    Any,
    Overdue,
    DueToday,

    /// <summary>Due today or within <see cref="DueDates.SoonDays"/> days, not overdue.</summary>
    DueThisWeek,

    HasDueDate,
    NoDueDate,
}

/// <summary>
/// Board search and filter criteria. Within one category, any selected value matches (OR);
/// across categories every active category must match (AND). An empty category is inactive.
/// </summary>
public sealed record CardFilter
{
    public static CardFilter None { get; } = new();

    /// <summary>Whitespace-separated terms; every term must appear in the title or description (case-insensitive).</summary>
    public string SearchText { get; init; } = "";

    public IReadOnlySet<Priority> Priorities { get; init; } = new HashSet<Priority>();

    /// <summary>Cards carrying at least one of these labels match.</summary>
    public IReadOnlySet<long> LabelIds { get; init; } = new HashSet<long>();

    public IReadOnlySet<long> ColumnIds { get; init; } = new HashSet<long>();

    public DueFilter Due { get; init; } = DueFilter.Any;

    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(SearchText)
        && Priorities.Count == 0
        && LabelIds.Count == 0
        && ColumnIds.Count == 0
        && Due == DueFilter.Any;

    public bool Matches(Card card, DateOnly today)
    {
        if (ColumnIds.Count > 0 && !ColumnIds.Contains(card.ColumnId))
        {
            return false;
        }

        if (Priorities.Count > 0 && !Priorities.Contains(card.Priority))
        {
            return false;
        }

        if (LabelIds.Count > 0 && !card.LabelIds.Any(LabelIds.Contains))
        {
            return false;
        }

        return MatchesDue(card.DueDate, today) && MatchesText(card);
    }

    private bool MatchesDue(DateOnly? dueDate, DateOnly today)
    {
        var state = DueDates.GetState(dueDate, today);
        return Due switch
        {
            DueFilter.Any => true,
            DueFilter.Overdue => state == DueState.Overdue,
            DueFilter.DueToday => state == DueState.DueToday,
            DueFilter.DueThisWeek => state is DueState.DueToday or DueState.DueSoon,
            DueFilter.HasDueDate => state != DueState.None,
            DueFilter.NoDueDate => state == DueState.None,
            _ => true,
        };
    }

    private bool MatchesText(Card card)
    {
        var terms = SearchText.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        return terms.All(term =>
            card.Title.Contains(term, StringComparison.CurrentCultureIgnoreCase)
            || card.Description.Contains(term, StringComparison.CurrentCultureIgnoreCase));
    }
}
