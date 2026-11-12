using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace DotNet11Lab.Web;

/// <summary>ActivitySource and Meter for lab executions, exported through OpenTelemetry.</summary>
public static class LabTelemetry
{
    public const string SourceName = "DotNet11Lab";
    public static readonly ActivitySource Source = new(SourceName);
    private static readonly Meter Meter = new(SourceName);
    public static readonly Counter<long> DemoRuns = Meter.CreateCounter<long>("dotnet11lab.demo.runs", description: "Number of lab demonstrations executed.");
}
