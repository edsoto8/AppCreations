namespace LoanPilot.Data.Tests.Support;

/// <summary>A controllable clock. Each read advances one millisecond so successive writes are ordered.</summary>
public sealed class TestTimeProvider(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public TestTimeProvider()
        : this(new DateTimeOffset(2026, 3, 10, 9, 0, 0, TimeSpan.Zero))
    {
    }

    public override DateTimeOffset GetUtcNow()
    {
        _now = _now.AddMilliseconds(1);
        return _now;
    }

    public void Advance(TimeSpan by) => _now += by;
}
