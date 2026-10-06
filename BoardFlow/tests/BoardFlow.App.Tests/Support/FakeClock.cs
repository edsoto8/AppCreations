using BoardFlow.Core;

namespace BoardFlow.Tests.App.Support;

public sealed class FakeClock : IClock
{
    private DateTime _now = new(2026, 3, 10, 9, 0, 0, DateTimeKind.Utc);

    public DateTime UtcNow => _now = _now.AddMilliseconds(1);

    public DateOnly Today => DateOnly.FromDateTime(_now);
}
