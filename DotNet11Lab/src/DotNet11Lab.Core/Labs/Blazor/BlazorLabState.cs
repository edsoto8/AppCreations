namespace DotNet11Lab.Core.Labs.Blazor;

public sealed record LabActivity(DateTimeOffset At, string Source, string Message);

// <snippet:Blazor.StateContainer>
/// <summary>
/// State container registered as <em>scoped</em>. With interactive server rendering a scope lives as long as the
/// circuit, so every interactive island on the page (they share one circuit) sees the same instance, while other
/// users and other browser tabs get their own. Prerendering runs in the HTTP request's scope, which is discarded.
/// </summary>
public sealed class BlazorLabState(TimeProvider time)
{
    public const int MaxActivity = 12;
    public const int MaxPinned = 8;

    private readonly Lock _gate = new();
    private readonly List<LabActivity> _activity = [];
    private readonly List<Transaction> _pinned = [];

    public Guid InstanceId { get; } = Guid.NewGuid();

    /// <summary>Raised after every change. Subscribers must marshal to their renderer with InvokeAsync.</summary>
    public event Action? Changed;

    public IReadOnlyList<LabActivity> Activity { get { lock (_gate) return [.. _activity]; } }

    public IReadOnlyList<Transaction> Pinned { get { lock (_gate) return [.. _pinned]; } }

    public void Record(string source, string message)
    {
        lock (_gate)
        {
            _activity.Insert(0, new LabActivity(time.GetUtcNow(), source, message));
            if (_activity.Count > MaxActivity) _activity.RemoveAt(_activity.Count - 1);
        }
        Changed?.Invoke();
    }

    public void Pin(Transaction transaction, string source)
    {
        lock (_gate)
        {
            _pinned.RemoveAll(t => t.Id == transaction.Id);
            _pinned.Insert(0, transaction);
            if (_pinned.Count > MaxPinned) _pinned.RemoveAt(_pinned.Count - 1);
        }
        Record(source, $"Pinned #{transaction.Id} {transaction.Merchant} {transaction.Amount:0.00}");
    }
}
// </snippet:Blazor.StateContainer>
