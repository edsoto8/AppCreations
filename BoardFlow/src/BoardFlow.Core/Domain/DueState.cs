namespace BoardFlow.Core.Domain;

public enum DueState
{
    /// <summary>The card has no due date.</summary>
    None,

    /// <summary>The due date is before today.</summary>
    Overdue,

    /// <summary>The due date is today.</summary>
    DueToday,

    /// <summary>The due date is within the next <see cref="Rules.DueDates.SoonDays"/> days (excluding today).</summary>
    DueSoon,

    /// <summary>The due date is further away.</summary>
    Later,
}
