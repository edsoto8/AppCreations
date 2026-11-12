using DotNet11Lab.Core.Labs.Performance;
using Microsoft.AspNetCore.Components;

namespace DotNet11Lab.Web.Components.Pages.Labs;

public partial class PerformanceLab
{
    private static readonly IReadOnlyCollection<string> CrossRuntimeCategories = ["Text", "Streams", "Json", "Async", "Collections", "Compression"];

    private static readonly (string Id, string Title, string Old, string? New)[] CodeTabs =
    [
        ("parse", "Parsing", "Perf.ParseSplit", "Perf.ParseSpan"),
        ("build", "String building", "Perf.BuildConcat", "Perf.BuildStringBuilder"),
        ("streams", "Streams", "Perf.StreamReader", "Perf.PipeReader"),
        ("json", "JSON", "Perf.JsonReflection", "Perf.JsonSourceGen"),
        ("async", "Task vs ValueTask", "Perf.AsyncTask", "Perf.AsyncValueTask"),
        ("linq", "LINQ vs loop", "Perf.Linq", "Perf.Loop"),
        ("lookup", "Lookups", "Perf.Lookup", null),
        ("compression", "Compression", "Perf.Compress", null),
    ];

    private const string ReproduceCommands = """
        # Full suite: every benchmark on .NET 10 (baseline) and .NET 11, then results/benchmarks/latest.json
        dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks

        # One area, e.g. JSON only
        dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --filter '*Json*'

        # Smoke test of the pipeline (short job, results marked preliminary)
        dotnet run -c Release -f net11.0 --project src/DotNet11Lab.Benchmarks -- --quick --filter '*TextBenchmarks*'
        """;

    [Inject] private BenchmarkResultsStore Results { get; set; } = default!;
    [Inject] private LivePerformanceRunner Runner { get; set; } = default!;
    [Inject] private PerformanceJournal Journal { get; set; } = default!;

    private ResultsLoad<BenchmarkResultsFile>? _published;
    private LiveRun? _live;
    private readonly HashSet<string> _selected = ["parse", "streams", "json-serialize", "async", "lookup"];
    private int _intensity = 1;
    private string _codeTab = "parse";
    private IReadOnlyList<JournalEntry> _history = [];
    private string? _historyError;
    private (string GroupId, string Workload) _trendWorkload;

    protected override async Task OnInitializedAsync()
    {
        _published = await Results.LoadAsync();
        await LoadHistoryAsync();
    }

    private async Task RunLiveAsync(CancellationToken cancellationToken)
    {
        // Keep the user's order stable (catalog order), whatever order the boxes were ticked in.
        var groups = Runner.Groups.Select(g => g.Id).Where(_selected.Contains).ToList();
        var run = await Runner.RunAsync(groups, _intensity, cancellationToken);
        _live = run;
        await Journal.RecordAsync(run, cancellationToken);
        _trendWorkload = (run.Results[0].GroupId, run.Results[0].Workload);
        await LoadHistoryAsync();
        // DemoPanel invokes OnRun as a plain delegate, so only the panel re-renders by itself; the journal section
        // below it belongs to this page.
        StateHasChanged();
    }

    private async Task LoadHistoryAsync()
    {
        try
        {
            _history = await Journal.GetRecentAsync(200);
            _historyError = null;
        }
        catch (Exception ex) when (ex is Microsoft.Data.Sqlite.SqliteException or IOException or UnauthorizedAccessException)
        {
            _historyError = ex.Message;
        }
    }

    private async Task ClearHistoryAsync()
    {
        await Journal.ClearAsync();
        await LoadHistoryAsync();
    }

    private void Toggle(string id, bool on)
    {
        if (on) _selected.Add(id);
        else _selected.Remove(id);
    }

    private void SelectAll()
    {
        foreach (var g in Runner.Groups) _selected.Add(g.Id);
    }

    private static (string, string) ParseTrendKey(string? value)
    {
        var parts = (value ?? "").Split('|', 2);
        return parts.Length == 2 ? (parts[0], parts[1]) : ("", "");
    }
}
