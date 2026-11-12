using System.Diagnostics;
using System.Runtime;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

namespace DotNet11Lab.Core.Labs.NativeAot;

/// <summary>Live facts about the process serving the dashboard (a JIT-compiled, framework-dependent app).</summary>
public sealed record ProcessSnapshot(
    DateTimeOffset CapturedUtc,
    DateTimeOffset? ProcessStartUtc,
    TimeSpan? Uptime,
    long WorkingSetBytes,
    long PeakWorkingSetBytes,
    long GcHeapBytes,
    long GcCommittedBytes,
    long TotalAllocatedBytes,
    int Gen0Collections,
    int Gen2Collections,
    bool ServerGc,
    bool IsDynamicCodeSupported,
    bool IsDynamicCodeCompiled,
    long JitCompiledMethods,
    TimeSpan JitCompilationTime,
    int LoadedAssemblies,
    string FrameworkDescription,
    string RuntimeIdentifier,
    string ProcessPath,
    int ProcessorCount)
{
    // <snippet:Aot.ProcessSnapshot>
    public static ProcessSnapshot Capture()
    {
        using var process = Process.GetCurrentProcess();
        process.Refresh();
        DateTimeOffset? started = null;
        try
        {
            started = process.StartTime.ToUniversalTime();
        }
        catch (Exception ex) when (ex is InvalidOperationException or NotSupportedException or System.ComponentModel.Win32Exception)
        {
            // Not available on every platform/sandbox; reported as unknown rather than guessed.
        }
        var now = DateTimeOffset.UtcNow;
        var gc = GC.GetGCMemoryInfo();
        return new ProcessSnapshot(
            now,
            started,
            started is { } s ? now - s : null,
            process.WorkingSet64,
            process.PeakWorkingSet64,
            GC.GetTotalMemory(forceFullCollection: false),
            gc.TotalCommittedBytes,
            GC.GetTotalAllocatedBytes(),
            GC.CollectionCount(0),
            GC.CollectionCount(2),
            GCSettings.IsServerGC,
            RuntimeFeature.IsDynamicCodeSupported,   // false under Native AOT
            RuntimeFeature.IsDynamicCodeCompiled,
            System.Runtime.JitInfo.GetCompiledMethodCount(),  // 0 under Native AOT: nothing is JIT-compiled
            System.Runtime.JitInfo.GetCompilationTime(),
            AppDomain.CurrentDomain.GetAssemblies().Length,
            RuntimeInformation.FrameworkDescription,
            RuntimeInformation.RuntimeIdentifier,
            Environment.ProcessPath ?? "",
            Environment.ProcessorCount);
    }
    // </snippet:Aot.ProcessSnapshot>
}
