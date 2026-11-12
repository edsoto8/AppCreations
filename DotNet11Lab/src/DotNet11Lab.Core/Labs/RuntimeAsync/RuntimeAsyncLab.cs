using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using DotNet11Lab.Core.Diagnostics;
using DotNet11Lab.Core.Source;

namespace DotNet11Lab.Core.Labs.RuntimeAsync;

/// <summary>One compiled copy of <see cref="AsyncChainWorkloads"/>, as delegates so both copies run through the same code.</summary>
public sealed record AsyncWorkloadSet(
    string Label,
    Type Type,
    Func<int, bool, CancellationToken, Task<int>> Chain,
    Func<int[], CancellationToken, Task<long>> PriceOrders,
    Func<int, bool, bool, CancellationToken, Task<string>> PlaceOrder);

/// <summary>How the compiler emitted one async method.</summary>
public sealed record AsyncMethodFacts(
    string Name,
    string ReturnType,
    MethodImplAttributes ImplFlags,
    bool HasAsyncImplFlag,
    string? StateMachineType,
    int IlBytes);

public sealed record AsyncAssemblyFacts(
    string Label,
    string AssemblyName,
    string TypeName,
    IReadOnlyList<AsyncMethodFacts> Methods,
    /// <summary>Compiler-generated nested types implementing <see cref="IAsyncStateMachine"/> in the workload type.</summary>
    IReadOnlyList<string> StateMachineTypes,
    /// <summary>Same count across the whole assembly.</summary>
    int AssemblyStateMachineTypeCount);

public sealed record WorkloadComparison(string Workload, long Classic, long RuntimeAsync)
{
    public bool Equal => Classic == RuntimeAsync;
}

/// <summary>Which stack a <see cref="StackCapture"/> holds.</summary>
public enum StackKind
{
    /// <summary><c>ex.ToString()</c> of an exception thrown after a suspension.</summary>
    Exception,
    /// <summary><c>new StackTrace()</c> while the whole chain is still running synchronously on the caller's thread.</summary>
    LiveBeforeSuspension,
    /// <summary><c>new StackTrace()</c> after the innermost method resumed on the thread pool.</summary>
    LiveAfterResume,
}

public sealed record StackCapture(string Label, string Text)
{
    /// <summary>The four methods of the demo chain, outermost first.</summary>
    public static readonly string[] ChainMethods = ["PlaceOrderAsync", "ValidateOrderAsync", "LoadCustomerAsync", "QueryDatabaseAsync"];

    /// <summary>Each "at ..." line reduced to <c>Type.Method</c> (namespace, parameters and file info removed).</summary>
    public IReadOnlyList<string> Frames => Text.Split('\n')
        .Select(l => l.Trim())
        .Where(l => l.StartsWith("at ", StringComparison.Ordinal))
        .Select(l =>
        {
            var name = l[3..];
            var paren = name.IndexOf('(');
            if (paren > 0) name = name[..paren];
            var parts = name.Split('.');
            return parts.Length >= 2 ? $"{parts[^2]}.{parts[^1]}" : name;
        })
        .ToList();

    public int FrameCount => Frames.Count;

    /// <summary>Which methods of the demo chain appear on the stack.</summary>
    public IReadOnlyList<string> ChainMethodsPresent => ChainMethods.Where(m => Text.Contains(m + "(", StringComparison.Ordinal)).ToList();

    /// <summary>Frames that belong to async infrastructure (state machine boxes, builders, execution context).</summary>
    public int AsyncInfrastructureFrames => Text.Split('\n').Count(l =>
        l.Contains("System.Runtime.CompilerServices.", StringComparison.Ordinal) || l.Contains("System.Threading.ExecutionContext.", StringComparison.Ordinal));

    /// <summary>Compiler-generated state machine names such as <c>&lt;QueryDatabaseAsync&gt;d__5</c>.</summary>
    public bool MentionsGeneratedStateMachines => Text.Contains(">d__", StringComparison.Ordinal);
}

/// <summary>
/// Lab 7: inspects and runs the same source compiled twice - classic state machines (this assembly) and
/// runtime-async=on (<c>experimental/DotNet11Lab.RuntimeAsync</c>). Core does not reference the experimental
/// project; the host (Web, tests) ships it, and it is loaded here by name.
/// </summary>
public sealed class RuntimeAsyncLab
{
    public const string ExperimentalAssemblyName = "DotNet11Lab.RuntimeAsync";
    public const string ExperimentalTypeName = "DotNet11Lab.RuntimeAsync.AsyncChainWorkloads";
    public const string ClassicSourceFile = "DotNet11Lab.Core/Labs/RuntimeAsync/AsyncChainWorkloads.cs";
    public const string RuntimeAsyncSourceFile = "DotNet11Lab.RuntimeAsync/AsyncChainWorkloads.cs";
    public const int MaxDepth = 200;
    public const int MaxIterations = 20_000;

    private readonly Lazy<AsyncWorkloadSet?> _runtimeAsync;

    public RuntimeAsyncLab()
    {
        Classic = new AsyncWorkloadSet("Classic state machine", typeof(AsyncChainWorkloads),
            AsyncChainWorkloads.ChainAsync, AsyncChainWorkloads.PriceOrdersAsync, AsyncChainWorkloads.PlaceOrderAsync);
        _runtimeAsync = new Lazy<AsyncWorkloadSet?>(LoadRuntimeAsync);
    }

    public AsyncWorkloadSet Classic { get; }

    /// <summary>Null when the experimental assembly is not deployed with the host.</summary>
    public AsyncWorkloadSet? RuntimeAsyncSet => _runtimeAsync.Value;

    public AsyncWorkloadSet RequireRuntimeAsync() => RuntimeAsyncSet
        ?? throw new InvalidOperationException($"Assembly '{ExperimentalAssemblyName}' is not available to this host.");

    private static AsyncWorkloadSet? LoadRuntimeAsync()
    {
        Assembly assembly;
        try
        {
            assembly = Assembly.Load(ExperimentalAssemblyName);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        var type = assembly.GetType(ExperimentalTypeName, throwOnError: true)!;
        T Bind<T>(string name) where T : Delegate =>
            type.GetMethod(name, BindingFlags.Public | BindingFlags.Static)!.CreateDelegate<T>();
        return new AsyncWorkloadSet("Runtime async", type,
            Bind<Func<int, bool, CancellationToken, Task<int>>>(nameof(AsyncChainWorkloads.ChainAsync)),
            Bind<Func<int[], CancellationToken, Task<long>>>(nameof(AsyncChainWorkloads.PriceOrdersAsync)),
            Bind<Func<int, bool, bool, CancellationToken, Task<string>>>(nameof(AsyncChainWorkloads.PlaceOrderAsync)));
    }

    // <snippet:RuntimeAsync.Inspect>
    /// <summary>Reads, by reflection, how each async method in <paramref name="set"/> was compiled.</summary>
    public static AsyncAssemblyFacts Inspect(AsyncWorkloadSet set)
    {
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly;
        var methods = set.Type.GetMethods(all)
            .Where(m => typeof(Task).IsAssignableFrom(m.ReturnType) || m.ReturnType.Name.StartsWith("ValueTask", StringComparison.Ordinal))
            .OrderBy(m => m.MetadataToken)
            .Select(m =>
            {
                var flags = m.MethodImplementationFlags;
                return new AsyncMethodFacts(
                    m.Name,
                    FriendlyName(m.ReturnType),
                    flags,
                    HasAsyncImplFlag: (flags & MethodImplAttributes.Async) != 0,
                    StateMachineType: m.GetCustomAttribute<AsyncStateMachineAttribute>()?.StateMachineType.Name,
                    IlBytes: m.GetMethodBody()?.GetILAsByteArray()?.Length ?? 0);
            })
            .ToList();

        static bool IsStateMachine(Type t) => typeof(IAsyncStateMachine).IsAssignableFrom(t) && t.IsDefined(typeof(CompilerGeneratedAttribute));
        var nested = set.Type.GetNestedTypes(BindingFlags.NonPublic | BindingFlags.Public).Where(IsStateMachine).Select(t => t.Name).ToList();
        var assemblyCount = set.Type.Assembly.GetTypes().Count(IsStateMachine);
        return new AsyncAssemblyFacts(set.Label, set.Type.Assembly.GetName().Name!, set.Type.FullName!, methods, nested, assemblyCount);
    }
    // </snippet:RuntimeAsync.Inspect>

    private static string FriendlyName(Type t) => t.IsGenericType
        ? $"{t.Name[..t.Name.IndexOf('`')]}<{string.Join(", ", t.GetGenericArguments().Select(FriendlyName))}>"
        : t.Name switch { "Int32" => "int", "Int64" => "long", "String" => "string", _ => t.Name };

    /// <summary>Runs every workload on both copies; the results must be identical.</summary>
    public async Task<IReadOnlyList<WorkloadComparison>> CompareResultsAsync(CancellationToken cancellationToken)
    {
        var ra = RequireRuntimeAsync();
        var amounts = CreateAmounts(2_000);
        return
        [
            new("ChainAsync(depth 50, completes synchronously)",
                await Classic.Chain(50, false, cancellationToken).ConfigureAwait(false),
                await ra.Chain(50, false, cancellationToken).ConfigureAwait(false)),
            new("ChainAsync(depth 50, Task.Yield at the leaf)",
                await Classic.Chain(50, true, cancellationToken).ConfigureAwait(false),
                await ra.Chain(50, true, cancellationToken).ConfigureAwait(false)),
            new("PriceOrdersAsync(2,000 amounts)",
                await Classic.PriceOrders(amounts, cancellationToken).ConfigureAwait(false),
                await ra.PriceOrders(amounts, cancellationToken).ConfigureAwait(false)),
        ];
    }

    // <snippet:RuntimeAsync.CaptureException>
    /// <summary>Throws from the innermost of four async methods (after a real suspension) and returns ex.ToString().</summary>
    public static async Task<StackCapture> CaptureExceptionAsync(AsyncWorkloadSet set, CancellationToken cancellationToken)
    {
        try
        {
            await set.PlaceOrder(42, true, true, cancellationToken).ConfigureAwait(false);
        }
        catch (InvalidOperationException ex)
        {
            return new StackCapture(set.Label, ex.ToString());
        }
        throw new UnreachableException("PlaceOrderAsync(fail: true) did not throw.");
    }

    /// <summary>
    /// Returns <c>new StackTrace()</c> captured inside the innermost method: before any suspension
    /// (<paramref name="afterResume"/> false: the whole chain is still running on this thread) or after it resumed.
    /// </summary>
    public static async Task<StackCapture> CaptureLiveStackAsync(AsyncWorkloadSet set, bool afterResume, CancellationToken cancellationToken) =>
        new(set.Label, await set.PlaceOrder(42, false, afterResume, cancellationToken).ConfigureAwait(false));
    // </snippet:RuntimeAsync.CaptureException>

    /// <summary>
    /// Plain-language observations computed from two captured stacks: only statements the text supports, so the page
    /// never claims a difference the current runtime does not show.
    /// </summary>
    public static IReadOnlyList<string> DescribeStacks(StackCapture classic, StackCapture runtimeAsync, StackKind kind)
    {
        var facts = new List<string>
        {
            $"Frames: {classic.FrameCount} (classic) vs {runtimeAsync.FrameCount} (runtime async).",
        };
        var userFramesClassic = classic.Frames.Where(f => f.StartsWith("AsyncChainWorkloads.", StringComparison.Ordinal)).ToList();
        var userFramesRa = runtimeAsync.Frames.Where(f => f.StartsWith("AsyncChainWorkloads.", StringComparison.Ordinal)).ToList();
        static string Chain(IEnumerable<string> frames) => string.Join(" ← ", frames.Select(f => f["AsyncChainWorkloads.".Length..]));
        var distinctClassic = userFramesClassic.Distinct().ToList();
        var distinctRa = userFramesRa.Distinct().ToList();
        if (userFramesClassic.SequenceEqual(userFramesRa))
        {
            facts.Add($"Both list the same chain methods in the same order: {Chain(userFramesClassic)}.");
        }
        else if (distinctClassic.SequenceEqual(distinctRa))
        {
            facts.Add($"Same chain in the same order ({Chain(distinctClassic)}), but the classic stack shows {userFramesClassic.Count} frames for it and runtime async {userFramesRa.Count}: " +
                "with state machines each method appears twice (the stub that calls AsyncMethodBuilderCore.Start, then the state machine's MoveNext, both displayed under the method's name).");
        }
        else
        {
            facts.Add($"Chain methods differ: classic [{Chain(userFramesClassic)}] vs runtime async [{Chain(userFramesRa)}].");
        }
        facts.Add($"Async infrastructure frames (System.Runtime.CompilerServices / ExecutionContext): {classic.AsyncInfrastructureFrames} vs {runtimeAsync.AsyncInfrastructureFrames}.");
        facts.Add((classic.MentionsGeneratedStateMachines, runtimeAsync.MentionsGeneratedStateMachines) switch
        {
            (false, false) => "Neither mentions compiler-generated <Method>d__N types: the runtime already presents state-machine frames under the original method names.",
            (true, false) => "Only the classic text mentions compiler-generated <Method>d__N types.",
            (false, true) => "Only the runtime-async text mentions compiler-generated <Method>d__N types.",
            _ => "Both mention compiler-generated <Method>d__N types.",
        });
        if (kind == StackKind.LiveAfterResume)
        {
            var missing = StackCapture.ChainMethods.Except(classic.ChainMethodsPresent).Intersect(StackCapture.ChainMethods.Except(runtimeAsync.ChainMethodsPresent)).ToList();
            if (missing.Count > 0)
                facts.Add($"Not on either live stack after resuming: {string.Join(", ", missing)}. The callers are suspended awaiting, not running, so a thread's stack cannot contain them; tools reconstruct such chains from task continuations instead.");
        }
        else if (kind == StackKind.Exception)
        {
            facts.Add("Microsoft's runtime notes say exception stack traces already look the same with or without runtime async; compare the two texts above.");
        }
        else
        {
            facts.Add("Microsoft's runtime notes describe this case: live stacks lose the state-machine infrastructure frames and show the real call chain.");
        }
        return facts;
    }

    /// <summary>Quick in-process timing of the async chain for both copies. Not a benchmark (see Lab 5 / BENCHMARKS.md).</summary>
    public async Task<IReadOnlyList<Measurement>> MeasureChainsAsync(int depth, int iterations, CancellationToken cancellationToken)
    {
        depth = Math.Clamp(depth, 1, MaxDepth);
        iterations = Math.Clamp(iterations, 1, MaxIterations);
        var ra = RequireRuntimeAsync();
        var results = new List<Measurement>();
        foreach (var yield in new[] { false, true })
        {
            var suffix = yield ? "yields at leaf" : "completes synchronously";
            foreach (var set in new[] { Classic, ra })
            {
                results.Add(await Measure.RunAsync($"{set.Label} · {suffix}", yield ? Math.Max(1, iterations / 10) : iterations,
                    () => set.Chain(depth, yield, cancellationToken), cancellationToken).ConfigureAwait(false));
            }
        }
        return results;
    }

    /// <summary>
    /// Compares the two embedded source files with their namespace lines removed. Returns null when identical,
    /// otherwise the first differing line.
    /// </summary>
    public static string? FindSourceDifference(SourceCatalog sources)
    {
        static string[] Body(string text) => text.Split('\n').Where(l => !l.StartsWith("namespace ", StringComparison.Ordinal)).ToArray();
        var a = Body(sources.GetFile(ClassicSourceFile));
        var b = Body(sources.GetFile(RuntimeAsyncSourceFile));
        for (var i = 0; i < Math.Max(a.Length, b.Length); i++)
        {
            var x = i < a.Length ? a[i] : "<end of file>";
            var y = i < b.Length ? b[i] : "<end of file>";
            if (x != y) return $"line {i + 1}: '{x.Trim()}' vs '{y.Trim()}'";
        }
        return null;
    }

    internal static int[] CreateAmounts(int count)
    {
        var random = new Random(7);
        var amounts = new int[count];
        for (var i = 0; i < amounts.Length; i++) amounts[i] = random.Next(1, 10_000);
        return amounts;
    }
}
