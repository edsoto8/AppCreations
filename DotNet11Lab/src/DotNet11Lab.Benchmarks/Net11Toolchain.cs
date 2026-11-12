using BenchmarkDotNet.Characteristics;
using BenchmarkDotNet.Running;
using BenchmarkDotNet.Toolchains;
using BenchmarkDotNet.Toolchains.CsProj;
using BenchmarkDotNet.Toolchains.DotNetCli;
using BenchmarkDotNet.Validators;

namespace DotNet11Lab.Benchmarks;

/// <summary>
/// BenchmarkDotNet 0.15.8 predates .NET 11: there is no <c>CoreRuntime.Core11_0</c> / <c>RuntimeMoniker</c> for it.
/// <c>CoreRuntime.CreateForNewVersion("net11.0", ...)</c> works for building and running, but its moniker is
/// <c>NotRecognized</c> and the toolchain's SDK validator then throws <c>NotImplementedException</c>
/// ("GetRuntimeVersion not implemented for NotRecognized"). This wrapper reuses the regular csproj toolchain for
/// <c>net11.0</c> (same generator, builder and executor) and skips only that validator. The .NET 11 SDK is
/// required to build this repository anyway (global.json), so the check it skips is already guaranteed.
/// </summary>
internal sealed class Net11Toolchain : IToolchain
{
    private readonly IToolchain _inner = CsProjCoreToolchain.From(new NetCoreAppSettings("net11.0", null, ".NET 11.0"));

    public static Net11Toolchain Instance { get; } = new();

    public string Name => _inner.Name;
    public IGenerator Generator => _inner.Generator;
    public IBuilder Builder => _inner.Builder;
    public IExecutor Executor => _inner.Executor;
    public bool IsInProcess => _inner.IsInProcess;

    public IEnumerable<ValidationError> Validate(BenchmarkCase benchmarkCase, IResolver resolver) => [];

    public override string ToString() => Name;
}
