using System.Diagnostics;

namespace DotNet11Lab.RuntimeAsync;

/// <summary>
/// Async workloads for Lab 7. Two copies of this file exist and must stay textually identical apart from the
/// namespace line: one in DotNet11Lab.Core (classic compiler-generated state machines) and one in
/// experimental/DotNet11Lab.RuntimeAsync (compiled with runtime-async=on). A test enforces this.
/// </summary>
public static class AsyncChainWorkloads
{
    /// <summary>Awaits <paramref name="depth"/> nested async calls. The leaf optionally yields (a real suspension).</summary>
    public static async Task<int> ChainAsync(int depth, bool yieldAtLeaf, CancellationToken cancellationToken)
    {
        if (depth <= 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (yieldAtLeaf) await Task.Yield();
            return 1;
        }
        return await ChainAsync(depth - 1, yieldAtLeaf, cancellationToken).ConfigureAwait(false) + 1;
    }

    /// <summary>Prices every amount through an async helper that suspends for one call in fifty.</summary>
    public static async Task<long> PriceOrdersAsync(int[] amounts, CancellationToken cancellationToken)
    {
        long total = 0;
        foreach (var amount in amounts)
        {
            total += await PriceAsync(amount, cancellationToken).ConfigureAwait(false);
        }
        return total;
    }

    private static async ValueTask<long> PriceAsync(int amount, CancellationToken cancellationToken)
    {
        if (amount % 50 == 0)
        {
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
        }
        return amount * 11L / 10;
    }

    /// <summary>
    /// A four-level call chain. When <paramref name="suspend"/> is true the innermost method first yields (a real
    /// suspension, resuming on the thread pool); otherwise the whole chain runs synchronously. It then either
    /// throws or returns the live stack trace captured at that point.
    /// </summary>
    public static async Task<string> PlaceOrderAsync(int orderId, bool fail, bool suspend, CancellationToken cancellationToken)
    {
        return await ValidateOrderAsync(orderId, fail, suspend, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<string> ValidateOrderAsync(int orderId, bool fail, bool suspend, CancellationToken cancellationToken)
    {
        return await LoadCustomerAsync(orderId, fail, suspend, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<string> LoadCustomerAsync(int orderId, bool fail, bool suspend, CancellationToken cancellationToken)
    {
        return await QueryDatabaseAsync(orderId, fail, suspend, cancellationToken).ConfigureAwait(false);
    }

    private static async Task<string> QueryDatabaseAsync(int orderId, bool fail, bool suspend, CancellationToken cancellationToken)
    {
        if (suspend) await Task.Yield();
        cancellationToken.ThrowIfCancellationRequested();
        if (fail) throw new InvalidOperationException($"Order {orderId}: the database connection was lost.");
        return new StackTrace(fNeedFileInfo: false).ToString();
    }
}
