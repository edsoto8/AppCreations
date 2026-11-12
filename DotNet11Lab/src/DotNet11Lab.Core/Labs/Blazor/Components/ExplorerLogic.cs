using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web.Virtualization;

namespace DotNet11Lab.Core.Labs.Blazor.Components;

/// <summary>
/// Counters for the virtualized list, kept outside the list's parent so updating them re-renders only the small
/// stats view (re-rendering the parent while Virtualize asks for items would be wasted work).
/// </summary>
public sealed class VirtualizeStats
{
    public int ProviderCalls { get; private set; }
    public int RowsMaterialized { get; private set; }
    public int LastStart { get; private set; }
    public int LastCount { get; private set; }
    public int FilterRuns { get; private set; }
    public int SupersededSearches { get; private set; }
    public TimeSpan LastFilterTime { get; private set; }
    public event Action? Changed;

    public void ItemsRequested(int start, int requested, int returned)
    {
        ProviderCalls++;
        RowsMaterialized += returned;
        (LastStart, LastCount) = (start, requested);
        Changed?.Invoke();
    }

    public void Filtered(TimeSpan elapsed)
    {
        FilterRuns++;
        LastFilterTime = elapsed;
        Changed?.Invoke();
    }

    public void Superseded()
    {
        SupersededSearches++;
        Changed?.Invoke();
    }
}

/// <summary>Logic of the 100k-row virtualized explorer (markup in DotNet11Lab.Web).</summary>
public abstract class TransactionExplorerBase : ComponentBase, IDisposable
{
    public const int DebounceMilliseconds = 250;

    [Inject] protected TransactionDataset Data { get; set; } = default!;
    [Inject] protected BlazorLabState LabState { get; set; } = default!;

    /// <summary>?item=N in the URL opens the list at row N (Virtualize.InitialItemIndex).</summary>
    [SupplyParameterFromQuery(Name = "item")] public int? InitialItem { get; set; }

    /// <summary>Identifies rows by key so Virtualize can keep its scroll anchor when the item source refreshes.</summary>
    protected static readonly IEqualityComparer<Transaction> ById = EqualityComparer<Transaction>.Create(t => t?.Id ?? 0);

    protected Virtualize<Transaction>? List { get; set; }
    protected VirtualizeStats Stats { get; } = new();
    protected TransactionSearchResult Current { get; private set; } = default!;
    protected string SearchText { get; set; } = "";
    protected string? Category { get; set; }
    protected TransactionStatus? Status { get; set; }
    protected decimal? MinAmount { get; set; }
    protected int JumpTarget { get; set; } = 50_000;
    protected string? JumpMessage { get; private set; }

    protected int InitialIndex => Math.Clamp((InitialItem ?? 1) - 1, 0, Data.Count - 1);

    private CancellationTokenSource? _debounce;

    protected override void OnInitialized() => Current = TransactionSearch.Filter(Data, new TransactionQuery());

    // <snippet:Blazor.ItemsProvider>
    /// <summary>Virtualize asks only for the rows in (and just around) the viewport.</summary>
    protected ValueTask<ItemsProviderResult<Transaction>> ProvideItemsAsync(ItemsProviderRequest request)
    {
        var matches = Current.Matches;
        var start = Math.Min(request.StartIndex, matches.Count);
        var count = Math.Min(request.Count, matches.Count - start);
        var page = new Transaction[count];
        for (var i = 0; i < count; i++) page[i] = matches[start + i];
        Stats.ItemsRequested(request.StartIndex, request.Count, count);
        return ValueTask.FromResult(new ItemsProviderResult<Transaction>(page, matches.Count));
    }
    // </snippet:Blazor.ItemsProvider>

    // <snippet:Blazor.DebouncedSearch>
    /// <summary>Each keystroke cancels the previous pending search; only the last one (after a pause) scans.</summary>
    protected async Task FilterChangedAsync()
    {
        _debounce?.Cancel();
        _debounce?.Dispose();
        var cts = _debounce = new CancellationTokenSource();
        try
        {
            await Task.Delay(DebounceMilliseconds, cts.Token);
            var query = new TransactionQuery(SearchText, Category, Status, MinAmount);
            Current = await Task.Run(() => TransactionSearch.Filter(Data, query, cts.Token), cts.Token);
            Stats.Filtered(Current.Elapsed);
            if (List is not null)
            {
                await List.RefreshDataAsync();   // tell Virtualize the item source changed
                if (Current.Matches.Count > 0) await List.ScrollToItemAsync(0, cts.Token);   // new results start at the top
            }
            StateHasChanged();
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            Stats.Superseded();
        }
    }
    // </snippet:Blazor.DebouncedSearch>

    // <snippet:Blazor.ScrollToItem>
    /// <summary>.NET 11: Virtualize.ScrollToItemAsync brings row N into view, measuring variable heights as it goes.</summary>
    protected async Task JumpAsync()
    {
        if (List is null) return;
        if (Current.Matches.Count == 0 || JumpTarget < 1 || JumpTarget > Current.Matches.Count)
        {
            JumpMessage = $"Enter a row between 1 and {Current.Matches.Count:N0}.";
            return;
        }
        await List.ScrollToItemAsync(JumpTarget - 1);
        var row = Current.Matches[JumpTarget - 1];
        JumpMessage = $"Scrolled to row {JumpTarget:N0}: #{row.Id} {row.Merchant}.";
        LabState.Record("Virtualize", JumpMessage);
    }
    // </snippet:Blazor.ScrollToItem>

    protected void Pin(Transaction transaction) => LabState.Pin(transaction, "Virtualize");

    public void Dispose()
    {
        _debounce?.Cancel();
        _debounce?.Dispose();
        GC.SuppressFinalize(this);
    }
}
