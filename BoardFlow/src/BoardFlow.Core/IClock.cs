namespace BoardFlow.Core;

/// <summary>Source of the current time, so date-dependent rules are testable.</summary>
public interface IClock
{
    DateTime UtcNow { get; }

    /// <summary>Today's date in the user's local time zone.</summary>
    DateOnly Today { get; }
}

public sealed class SystemClock : IClock
{
    public DateTime UtcNow => DateTime.UtcNow;

    public DateOnly Today => DateOnly.FromDateTime(DateTime.Now);
}
