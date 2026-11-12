using System.Diagnostics;
using System.Reflection;

namespace DotNet11Lab.Core.Labs.Performance;

/// <summary>
/// Whether an assembly was compiled with optimizations. Matters for live measurements: a Debug build disables JIT
/// optimizations and makes Roslyn emit async state machines as classes, so every async call allocates (we measured
/// +48 B per ValueTask call that completes synchronously). BenchmarkDotNet always measures Release builds.
/// </summary>
public static class BuildInfo
{
    public static bool IsOptimized(Assembly assembly) =>
        assembly.GetCustomAttribute<DebuggableAttribute>() is not { IsJITOptimizerDisabled: true };

    public static string Describe(Assembly assembly) => IsOptimized(assembly) ? "Release" : "Debug";

    /// <summary>Build of the assembly holding the live workloads (DotNet11Lab.Core).</summary>
    public static string Workloads => Describe(typeof(BuildInfo).Assembly);

    public const string RunReleaseCommand = "dotnet run -c Release --project src/DotNet11Lab.Web";
}
