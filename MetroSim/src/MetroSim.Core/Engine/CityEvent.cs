namespace MetroSim.Core.Engine;

public enum EventSeverity : byte
{
    Info = 0,
    Warning = 1,
    Critical = 2,
}

/// <summary>A notification for the player. <see cref="Tile"/> is -1 when not tied to a place.</summary>
public sealed record CityEvent(long Tick, EventSeverity Severity, string Message, int Tile);

public sealed class EventLog
{
    public const int Capacity = 100;

    private readonly List<CityEvent> _events = [];

    public IReadOnlyList<CityEvent> Items => _events;

    /// <summary>Total events ever added; lets the UI detect new ones cheaply.</summary>
    public long TotalCount { get; private set; }

    public void Add(CityEvent e)
    {
        _events.Add(e);
        TotalCount++;
        if (_events.Count > Capacity)
        {
            _events.RemoveAt(0);
        }
    }

    internal void Restore(IEnumerable<CityEvent> events, long total)
    {
        _events.Clear();
        _events.AddRange(events);
        TotalCount = total;
    }
}
