using System.Globalization;
using System.Runtime.InteropServices;
using DotNet11Lab.Core.Labs.NativeAot;
using DotNet11Lab.Core.Labs.Performance;
using Microsoft.AspNetCore.Components;

namespace DotNet11Lab.Web.Components.Pages.Labs;

public partial class NativeAotLab
{
    // Project files are not embedded (only .cs files are); a test checks this excerpt against the real csproj.
    internal const string CliCsproj = """
        <Project Sdk="Microsoft.NET.Sdk">
          <PropertyGroup>
            <OutputType>Exe</OutputType>
            <AssemblyName>dotnet11lab</AssemblyName>
            <IsAotCompatible>true</IsAotCompatible>
            <InvariantGlobalization>true</InvariantGlobalization>
          </PropertyGroup>
        </Project>
        """;

    private static readonly string PublishCommands = $"""
        # framework-dependent
        dotnet publish src/DotNet11Lab.Cli -c Release -r {RuntimeInformation.RuntimeIdentifier} --self-contained false
        # self-contained single file
        dotnet publish src/DotNet11Lab.Cli -c Release -r {RuntimeInformation.RuntimeIdentifier} --self-contained true -p:PublishSingleFile=true
        # Native AOT
        dotnet publish src/DotNet11Lab.Cli -c Release -r {RuntimeInformation.RuntimeIdentifier} -p:PublishAot=true

        # all three + measurements -> results/publish/latest.json
        ./scripts/publish-compare.sh --runs 20
        pwsh ./scripts/publish-compare.ps1 -Runs 20
        """;

    [Inject] private PublishResultsStore Results { get; set; } = default!;

    private ResultsLoad<PublishResultsFile>? _load;
    private ProcessSnapshot? _snapshot;

    protected override async Task OnInitializedAsync()
    {
        _load = await Results.LoadAsync();
        _snapshot = ProcessSnapshot.Capture();
    }

    private Task RefreshAsync(CancellationToken cancellationToken)
    {
        _snapshot = ProcessSnapshot.Capture();
        return Task.CompletedTask;
    }

    private static string ModeTitle(string mode) => mode switch
    {
        "framework-dependent" => "Framework-dependent",
        "self-contained" => "Self-contained",
        "native-aot" => "Native AOT",
        _ => mode,
    };

    private static int Series(string mode) => mode switch
    {
        "native-aot" => 0,
        "self-contained" => 2,
        _ => 1,
    };

    private static string FormatUptime(TimeSpan t) => t.TotalHours >= 1
        ? t.ToString(@"h\h\ mm\m", CultureInfo.InvariantCulture)
        : t.ToString(@"m\m\ ss\s", CultureInfo.InvariantCulture);
}
