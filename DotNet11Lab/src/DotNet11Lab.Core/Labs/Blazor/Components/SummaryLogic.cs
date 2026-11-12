using Microsoft.AspNetCore.Components;

namespace DotNet11Lab.Core.Labs.Blazor.Components;

/// <summary>What the dashboard cards show. Serializable, so it can be persisted across prerendering.</summary>
public sealed record DashboardSummary(
    int Transactions,
    decimal Volume,
    int Disputed,
    string TopCategory,
    string LoadedDuring,
    DateTimeOffset LoadedAt,
    double QueryMilliseconds);

/// <summary>
/// "Expensive" summary query: a real aggregation over the ledger plus a simulated database round trip.
/// Counts how many times each component kind ran it (process-wide, since the service is a singleton).
/// </summary>
public sealed class SummaryLoader(TransactionDataset data, TimeProvider time)
{
    public static readonly TimeSpan SimulatedDatabaseLatency = TimeSpan.FromMilliseconds(250);
    private int _persistedLoads, _plainLoads;

    /// <summary>Raised after each load so a view can refresh its counters.</summary>
    public event Action? Loaded;

    public int PersistedLoads => Volatile.Read(ref _persistedLoads);
    public int PlainLoads => Volatile.Read(ref _plainLoads);

    public async Task<DashboardSummary> LoadAsync(string renderer, bool persisted, CancellationToken cancellationToken)
    {
        Interlocked.Increment(ref persisted ? ref _persistedLoads : ref _plainLoads);
        var started = time.GetTimestamp();
        await Task.Delay(SimulatedDatabaseLatency, time, cancellationToken);
        var items = data.Items;
        var volume = 0m;
        var disputed = 0;
        var byCategory = new Dictionary<string, decimal>(StringComparer.Ordinal);
        foreach (var t in items)
        {
            volume += t.Amount;
            if (t.Status == TransactionStatus.Disputed) disputed++;
            byCategory[t.Category] = byCategory.GetValueOrDefault(t.Category) + t.Amount;
        }
        var top = byCategory.MaxBy(kv => kv.Value).Key;
        Loaded?.Invoke();
        return new DashboardSummary(items.Count, volume, disputed, top, renderer, time.GetUtcNow(), time.GetElapsedTime(started).TotalMilliseconds);
    }
}

// <snippet:Blazor.PersistentState>
/// <summary>
/// [PersistentState] (.NET 10+): the value loaded during prerendering is serialized into the page and restored when
/// the component becomes interactive, so OnInitializedAsync finds it already set and skips the second load.
/// </summary>
public abstract class PersistedSummaryBase : ComponentBase
{
    [Inject] protected SummaryLoader Loader { get; set; } = default!;

    [PersistentState]
    public DashboardSummary? Summary { get; set; }

    protected override async Task OnInitializedAsync() =>
        Summary ??= await Loader.LoadAsync(RendererInfo.Name, persisted: true, CancellationToken.None);
}

/// <summary>Same component without persistence: it loads once while prerendering and again once interactive.</summary>
public abstract class PlainSummaryBase : ComponentBase
{
    [Inject] protected SummaryLoader Loader { get; set; } = default!;

    protected DashboardSummary? Summary { get; private set; }

    protected override async Task OnInitializedAsync() =>
        Summary = await Loader.LoadAsync(RendererInfo.Name, persisted: false, CancellationToken.None);
}
// </snippet:Blazor.PersistentState>
