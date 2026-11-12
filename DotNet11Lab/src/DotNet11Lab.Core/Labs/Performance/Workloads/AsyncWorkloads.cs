namespace DotNet11Lab.Core.Labs.Performance.Workloads;

/// <summary>
/// Calls a method that almost always completes synchronously (a cache hit), returned three ways. Shared with
/// DotNet11Lab.Benchmarks. Compiled with the classic async state machine (runtime async is not enabled here).
/// </summary>
public static class AsyncWorkloads
{
    // <snippet:Perf.AsyncSync>
    public static long SumSynchronously(int calls)
    {
        long sum = 0;
        for (var i = 0; i < calls; i++) sum += GetCached(i);
        return sum;
    }

    private static int GetCached(int key) => key * 3;
    // </snippet:Perf.AsyncSync>

    // <snippet:Perf.AsyncTask>
    // A Task<int> completed with a value outside the builder's small cache (-1..8) is a new heap object.
    public static async Task<long> SumViaTaskAsync(int calls)
    {
        long sum = 0;
        for (var i = 0; i < calls; i++) sum += await GetCachedTaskAsync(i).ConfigureAwait(false);
        return sum;
    }

    private static async Task<int> GetCachedTaskAsync(int key)
    {
        if (key < 0) await Task.Yield(); // cache miss path, never taken here
        return key * 3;
    }
    // </snippet:Perf.AsyncTask>

    // <snippet:Perf.AsyncValueTask>
    // A ValueTask<int> that completes synchronously wraps the int itself: nothing reaches the heap.
    public static async Task<long> SumViaValueTaskAsync(int calls)
    {
        long sum = 0;
        for (var i = 0; i < calls; i++) sum += await GetCachedValueTaskAsync(i).ConfigureAwait(false);
        return sum;
    }

    private static async ValueTask<int> GetCachedValueTaskAsync(int key)
    {
        if (key < 0) await Task.Yield(); // cache miss path, never taken here
        return key * 3;
    }
    // </snippet:Perf.AsyncValueTask>
}
