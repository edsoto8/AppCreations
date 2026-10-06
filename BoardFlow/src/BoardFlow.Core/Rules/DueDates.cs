using BoardFlow.Core.Domain;

namespace BoardFlow.Core.Rules;

public static class DueDates
{
    /// <summary>How many days ahead (after today) count as "due soon".</summary>
    public const int SoonDays = 7;

    public static DueState GetState(DateOnly? dueDate, DateOnly today)
    {
        if (dueDate is not { } due)
        {
            return DueState.None;
        }

        if (due < today)
        {
            return DueState.Overdue;
        }

        if (due == today)
        {
            return DueState.DueToday;
        }

        return due <= today.AddDays(SoonDays) ? DueState.DueSoon : DueState.Later;
    }
}
