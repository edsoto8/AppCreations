using System.Reflection;
using System.Runtime.CompilerServices;
using DotNet11Lab.Core.Source;
using Classic = DotNet11Lab.Core.Labs.RuntimeAsync.AsyncChainWorkloads;
using Lab = DotNet11Lab.Core.Labs.RuntimeAsync.RuntimeAsyncLab;
using RuntimeAsyncCopy = DotNet11Lab.RuntimeAsync.AsyncChainWorkloads;

namespace DotNet11Lab.Tests.Lab7RuntimeAsync;

public class RuntimeAsyncReflectionTests
{
    private const BindingFlags AllStatic = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.DeclaredOnly;

    public static TheoryData<string> AsyncMethods() =>
        ["ChainAsync", "PriceOrdersAsync", "PriceAsync", "PlaceOrderAsync", "ValidateOrderAsync", "LoadCustomerAsync", "QueryDatabaseAsync"];

    [Theory]
    [MemberData(nameof(AsyncMethods))]
    public void Runtime_async_copy_is_flagged_Async_and_has_no_state_machine(string name)
    {
        var method = typeof(RuntimeAsyncCopy).GetMethod(name, AllStatic)!;

        Assert.True((method.MethodImplementationFlags & MethodImplAttributes.Async) != 0);
        Assert.Null(method.GetCustomAttribute<AsyncStateMachineAttribute>());
    }

    [Theory]
    [MemberData(nameof(AsyncMethods))]
    public void Classic_copy_has_a_state_machine_and_no_Async_flag(string name)
    {
        var method = typeof(Classic).GetMethod(name, AllStatic)!;

        Assert.Equal(MethodImplAttributes.IL, method.MethodImplementationFlags & MethodImplAttributes.Async);
        var attribute = method.GetCustomAttribute<AsyncStateMachineAttribute>();
        Assert.NotNull(attribute);
        Assert.True(typeof(IAsyncStateMachine).IsAssignableFrom(attribute.StateMachineType));
    }

    [Fact]
    public void Inspector_reports_generated_types_only_for_the_classic_copy()
    {
        var lab = new Lab();
        var classic = Lab.Inspect(lab.Classic);
        var runtimeAsync = Lab.Inspect(lab.RequireRuntimeAsync());

        Assert.Equal(7, classic.Methods.Count);
        Assert.Equal(7, classic.StateMachineTypes.Count);
        Assert.All(classic.Methods, m => Assert.False(m.HasAsyncImplFlag));
        Assert.Equal(7, runtimeAsync.Methods.Count);
        Assert.Empty(runtimeAsync.StateMachineTypes);
        Assert.Equal(0, runtimeAsync.AssemblyStateMachineTypeCount);
        Assert.All(runtimeAsync.Methods, m => Assert.True(m.HasAsyncImplFlag && m.StateMachineType is null));
    }

    [Fact]
    public void Runtime_async_is_enabled_only_in_the_experimental_project()
    {
        var root = Infrastructure.SnippetReferenceTests.RepoRoot();
        var withFlag = Directory.EnumerateFiles(root, "*.csproj", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}artifacts{Path.DirectorySeparatorChar}", StringComparison.Ordinal))
            .Where(f => File.ReadAllText(f).Contains("runtime-async=on", StringComparison.Ordinal))
            .Select(Path.GetFileName)
            .ToList();

        Assert.Equal(["DotNet11Lab.RuntimeAsync.csproj"], withFlag);
        Assert.Contains("<Features>$(Features);runtime-async=on</Features>",
            File.ReadAllText(Path.Combine(root, "experimental", "DotNet11Lab.RuntimeAsync", "DotNet11Lab.RuntimeAsync.csproj")), StringComparison.Ordinal);
    }
}

public class RuntimeAsyncBehaviourTests
{
    private static readonly SourceCatalog Sources = new([typeof(Classic).Assembly, typeof(RuntimeAsyncCopy).Assembly]);

    [Fact]
    public void Both_copies_are_textually_identical_apart_from_the_namespace() =>
        Assert.Null(Lab.FindSourceDifference(Sources));

    [Fact]
    public async Task Both_copies_compute_identical_results()
    {
        var comparisons = await new Lab().CompareResultsAsync(TestContext.Current.CancellationToken);

        Assert.Equal(3, comparisons.Count);
        Assert.All(comparisons, c => Assert.True(c.Equal, $"{c.Workload}: {c.Classic} vs {c.RuntimeAsync}"));
        Assert.Equal(51, comparisons[0].Classic);
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(25, true)]
    public async Task Chains_agree_directly(int depth, bool yieldAtLeaf)
    {
        var ct = TestContext.Current.CancellationToken;
        Assert.Equal(await Classic.ChainAsync(depth, yieldAtLeaf, ct), await RuntimeAsyncCopy.ChainAsync(depth, yieldAtLeaf, ct));
    }

    [Fact]
    public async Task Exceptions_from_both_copies_name_the_whole_chain()
    {
        var lab = new Lab();
        var ct = TestContext.Current.CancellationToken;

        var classic = await Lab.CaptureExceptionAsync(lab.Classic, ct);
        var runtimeAsync = await Lab.CaptureExceptionAsync(lab.RequireRuntimeAsync(), ct);

        foreach (var capture in new[] { classic, runtimeAsync })
        {
            Assert.StartsWith("System.InvalidOperationException: Order 42", capture.Text, StringComparison.Ordinal);
            Assert.Equal(Core.Labs.RuntimeAsync.StackCapture.ChainMethods, capture.ChainMethodsPresent);
        }
        var facts = Lab.DescribeStacks(classic, runtimeAsync, Core.Labs.RuntimeAsync.StackKind.Exception);
        Assert.StartsWith($"Frames: {classic.FrameCount} (classic) vs {runtimeAsync.FrameCount}", facts[0], StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Live_stacks_are_captured_inside_the_innermost_method(bool afterResume)
    {
        var lab = new Lab();
        var ct = TestContext.Current.CancellationToken;

        var classic = await Lab.CaptureLiveStackAsync(lab.Classic, afterResume, ct);
        var runtimeAsync = await Lab.CaptureLiveStackAsync(lab.RequireRuntimeAsync(), afterResume, ct);

        Assert.Contains("QueryDatabaseAsync", classic.Frames[0], StringComparison.Ordinal);
        Assert.Contains("QueryDatabaseAsync", runtimeAsync.Frames[0], StringComparison.Ordinal);
        var kind = afterResume ? Core.Labs.RuntimeAsync.StackKind.LiveAfterResume : Core.Labs.RuntimeAsync.StackKind.LiveBeforeSuspension;
        Assert.NotEmpty(Lab.DescribeStacks(classic, runtimeAsync, kind));
    }

    [Fact]
    public async Task Before_any_suspension_both_live_stacks_contain_the_whole_chain_and_runtime_async_has_fewer_frames()
    {
        var lab = new Lab();
        var ct = TestContext.Current.CancellationToken;

        var classic = await Lab.CaptureLiveStackAsync(lab.Classic, afterResume: false, ct);
        var runtimeAsync = await Lab.CaptureLiveStackAsync(lab.RequireRuntimeAsync(), afterResume: false, ct);

        Assert.Equal(Core.Labs.RuntimeAsync.StackCapture.ChainMethods, classic.ChainMethodsPresent);
        Assert.Equal(Core.Labs.RuntimeAsync.StackCapture.ChainMethods, runtimeAsync.ChainMethodsPresent);
        Assert.True(runtimeAsync.AsyncInfrastructureFrames < classic.AsyncInfrastructureFrames,
            $"infrastructure frames: runtime async {runtimeAsync.AsyncInfrastructureFrames}, classic {classic.AsyncInfrastructureFrames}");
    }

    [Fact]
    public async Task Quick_measurement_clamps_inputs_and_covers_both_copies()
    {
        var results = await new Lab().MeasureChainsAsync(depth: 10_000, iterations: 5, TestContext.Current.CancellationToken);

        Assert.Equal(4, results.Count);
        Assert.Equal(2, results.Count(r => r.Name.StartsWith("Classic", StringComparison.Ordinal)));
        Assert.All(results, r => Assert.True(r.Iterations >= 1 && r.Elapsed > TimeSpan.Zero));
    }
}
