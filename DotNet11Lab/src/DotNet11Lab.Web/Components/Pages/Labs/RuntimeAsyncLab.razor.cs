using DotNet11Lab.Core.Diagnostics;
using DotNet11Lab.Core.Labs.Performance;
using DotNet11Lab.Core.Labs.RuntimeAsync;
using DotNet11Lab.Core.Source;
using Microsoft.AspNetCore.Components;
using LabService = DotNet11Lab.Core.Labs.RuntimeAsync.RuntimeAsyncLab;

namespace DotNet11Lab.Web.Components.Pages.Labs;

public partial class RuntimeAsyncLab
{
    // The project file is not embedded (only .cs files are), so this excerpt is shown as text. A test checks that
    // the real csproj still contains the flag line shown here.
    internal const string CsprojExcerpt = """
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <!-- Opt this assembly (and only this one) into runtime async -->
            <Features>$(Features);runtime-async=on</Features>
          </PropertyGroup>
        </Project>
        """;

    [Inject] private LabService Lab { get; set; } = default!;
    [Inject] private SourceCatalog Sources { get; set; } = default!;
    [Inject] private BenchmarkResultsStore Results { get; set; } = default!;

    private AsyncAssemblyFacts _classicFacts = default!;
    private AsyncAssemblyFacts? _runtimeAsyncFacts;
    private string? _sourceDifference;
    private string _runtimeAsyncSource = "";
    private ResultsLoad<BenchmarkResultsFile>? _published;

    private IReadOnlyList<WorkloadComparison> _comparisons = [];
    private StackCapture? _classicException, _runtimeAsyncException, _classicSync, _runtimeAsyncSync, _classicResumed, _runtimeAsyncResumed;
    private StackKind _stackTab = StackKind.LiveBeforeSuspension;
    private IReadOnlyList<Measurement> _measurements = [];
    private int _depth = 20;
    private int _iterations = 5_000;

    protected override async Task OnInitializedAsync()
    {
        _classicFacts = LabService.Inspect(Lab.Classic);
        _runtimeAsyncFacts = Lab.RuntimeAsyncSet is { } set ? LabService.Inspect(set) : null;
        _sourceDifference = LabService.FindSourceDifference(Sources);
        _runtimeAsyncSource = Sources.GetFile(LabService.RuntimeAsyncSourceFile).Trim();
        _published = await Results.LoadAsync();
    }

    private async Task CompareAsync(CancellationToken cancellationToken) =>
        _comparisons = await Lab.CompareResultsAsync(cancellationToken);

    private async Task CaptureStacksAsync(CancellationToken cancellationToken)
    {
        var ra = Lab.RequireRuntimeAsync();
        // Task.Run: start on the thread pool so Task.Yield resumes there (as in a console app or service), not on
        // Blazor's renderer synchronization context, which would add its own frames to the live stack.
        (_classicException, _runtimeAsyncException, _classicSync, _runtimeAsyncSync, _classicResumed, _runtimeAsyncResumed) = await Task.Run(async () => (
            await LabService.CaptureExceptionAsync(Lab.Classic, cancellationToken),
            await LabService.CaptureExceptionAsync(ra, cancellationToken),
            await LabService.CaptureLiveStackAsync(Lab.Classic, afterResume: false, cancellationToken),
            await LabService.CaptureLiveStackAsync(ra, afterResume: false, cancellationToken),
            await LabService.CaptureLiveStackAsync(Lab.Classic, afterResume: true, cancellationToken),
            await LabService.CaptureLiveStackAsync(ra, afterResume: true, cancellationToken)), cancellationToken);
    }

    private (StackCapture? Classic, StackCapture? RuntimeAsync) SelectedStacks => _stackTab switch
    {
        StackKind.Exception => (_classicException, _runtimeAsyncException),
        StackKind.LiveBeforeSuspension => (_classicSync, _runtimeAsyncSync),
        _ => (_classicResumed, _runtimeAsyncResumed),
    };

    private async Task MeasureAsync(CancellationToken cancellationToken)
    {
        _depth = Math.Clamp(_depth, 1, LabService.MaxDepth);
        _iterations = Math.Clamp(_iterations, 1, LabService.MaxIterations);
        _measurements = await Task.Run(() => Lab.MeasureChainsAsync(_depth, _iterations, cancellationToken), cancellationToken);
    }
}
