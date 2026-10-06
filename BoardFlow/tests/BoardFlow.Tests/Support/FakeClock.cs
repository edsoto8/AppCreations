using BoardFlow.Core;

namespace BoardFlow.Tests.Support;

/// <summary>A controllable clock. Each read of <see cref="UtcNow"/> advances one millisecond so writes are ordered.</summary>
public sealed class FakeClock(DateTime start) : IClock
{
    private DateTime _now = DateTime.SpecifyKind(start, DateTimeKind.Utc);

    public FakeClock()
        : this(new DateTime(2026, 3, 10, 9, 0, 0, DateTimeKind.Utc))
    {
    }

    public DateTime UtcNow => _now = _now.AddMilliseconds(1);

    public DateOnly Today => DateOnly.FromDateTime(_now);

    public void Advance(TimeSpan by) => _now += by;
}
