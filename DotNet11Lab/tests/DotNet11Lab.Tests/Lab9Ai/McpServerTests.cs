using System.Diagnostics;
using DotNet11Lab.Core.Labs.Ai;
using DotNet11Lab.Core.Labs.Ai.Mcp;
using DotNet11Lab.Tests.Infrastructure;

namespace DotNet11Lab.Tests.Lab9Ai;

/// <summary>
/// Starts the real experimental/DotNet11Lab.Mcp server as a child process over stdio. The test project does not
/// reference the MCP SDK; the server is built as part of DotNet11Lab.slnx ('dotnet test --solution' builds it first).
/// </summary>
public class McpServerTests
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;

    private static string ServerPath()
    {
        var path = McpServerLocator.Find(null, SnippetReferenceTests.RepoRoot());
        Assert.SkipWhen(path is null, "DotNet11Lab.Mcp is not built; run 'dotnet build DotNet11Lab.slnx' first.");
        return path!;
    }

    [Fact]
    public async Task Server_lists_and_calls_tools_over_stdio_json_rpc()
    {
        var result = await McpStdioProbe.RunAsync(ServerPath(), labNumber: 6, Ct);

        Assert.Equal("dotnet11lab-mcp", result.ServerName);
        string[] expected = [LabAiTools.GetLabFeaturesName, LabAiTools.GetRuntimeInfoName, LabAiTools.MeasureZstandardName, LabAiTools.SearchFeaturesName];
        Assert.Equal(expected.Order(StringComparer.Ordinal), result.ToolNames.Order(StringComparer.Ordinal));
        Assert.False(result.ToolResultIsError);
        Assert.Contains("Library Features", result.ToolResultText, StringComparison.Ordinal);
        Assert.True(result.Transcript.Count >= 6, "initialize, initialized, tools/list, tools/call and replies");
        Assert.Contains(result.Transcript, m => m.FromClient && m.Json.Contains("\"tools/call\"", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Mcp_tools_become_AIFunctions_that_the_function_invoking_pipeline_calls()
    {
        var start = McpServerLocator.CreateStartInfo(ServerPath(), "--client-demo", "What's new in lab 2?");
        start.RedirectStandardOutput = start.RedirectStandardError = true;
        using var process = Process.Start(start)!;
        var output = await process.StandardOutput.ReadToEndAsync(Ct);
        await process.WaitForExitAsync(Ct);

        Assert.Equal(0, process.ExitCode);
        Assert.Contains("tool: get_lab_features", output, StringComparison.Ordinal);
        Assert.Contains("model called: get_lab_features", output, StringComparison.Ordinal);
        Assert.Contains("Enumerable.FullJoin", output, StringComparison.Ordinal);
    }
}
