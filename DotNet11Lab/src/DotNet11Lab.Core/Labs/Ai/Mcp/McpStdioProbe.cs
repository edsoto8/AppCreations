using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace DotNet11Lab.Core.Labs.Ai.Mcp;

public sealed record McpWireMessage(bool FromClient, string Json);

public sealed record McpProbeResult(
    string ServerName, string ServerVersion, string ProtocolVersion,
    IReadOnlyList<string> ToolNames, string ToolCalled, string ToolResultText, bool ToolResultIsError,
    IReadOnlyList<McpWireMessage> Transcript, TimeSpan Elapsed);

/// <summary>
/// Talks to the DotNet11Lab.Mcp server at the wire level (newline-delimited JSON-RPC 2.0 over stdin/stdout), with no MCP
/// SDK on this side, so the dashboard can show exactly what crosses the process boundary: initialize, tools/list and
/// tools/call. The SDK client (<c>McpClient</c>) does the same thing for you; see McpToolBridge.
/// </summary>
public static class McpStdioProbe
{
    public const string ProtocolVersion = "2025-06-18";
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    public static async Task<McpProbeResult> RunAsync(string serverPath, int labNumber, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(labNumber, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(labNumber, 9);
        var start = McpServerLocator.CreateStartInfo(serverPath);
        start.RedirectStandardInput = start.RedirectStandardOutput = start.RedirectStandardError = true;
        start.UseShellExecute = false;

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(Timeout);
        var ct = timeout.Token;
        var sw = Stopwatch.StartNew();
        var transcript = new List<McpWireMessage>();

        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start the MCP server process.");
        _ = process.StandardError.ReadToEndAsync(ct); // server logs go to stderr; drain so it never blocks
        try
        {
            // <snippet:Ai.McpWire>
            var init = await RequestAsync(1, "initialize", new JsonObject
            {
                ["protocolVersion"] = ProtocolVersion,
                ["capabilities"] = new JsonObject(),
                ["clientInfo"] = new JsonObject { ["name"] = "dotnet11lab-probe", ["version"] = "1.0" },
            });
            await SendAsync(new JsonObject { ["jsonrpc"] = "2.0", ["method"] = "notifications/initialized" });

            var list = await RequestAsync(2, "tools/list", new JsonObject());
            var call = await RequestAsync(3, "tools/call", new JsonObject
            {
                ["name"] = LabAiTools.GetLabFeaturesName,
                ["arguments"] = new JsonObject { ["labNumber"] = labNumber },
            });
            // </snippet:Ai.McpWire>

            var server = init.GetProperty("serverInfo");
            var content = call.GetProperty("content");
            return new(
                server.GetProperty("name").GetString() ?? "?",
                server.TryGetProperty("version", out var v) ? v.GetString() ?? "" : "",
                init.GetProperty("protocolVersion").GetString() ?? "?",
                [.. list.GetProperty("tools").EnumerateArray().Select(t => t.GetProperty("name").GetString() ?? "?")],
                LabAiTools.GetLabFeaturesName,
                content.GetArrayLength() > 0 && content[0].TryGetProperty("text", out var text) ? text.GetString() ?? "" : "",
                call.TryGetProperty("isError", out var isError) && isError.GetBoolean(),
                transcript,
                sw.Elapsed);
        }
        finally
        {
            process.StandardInput.Close(); // closing stdin is the stdio transport's shutdown signal
            using var exit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try { await process.WaitForExitAsync(exit.Token); }
            catch (OperationCanceledException) { process.Kill(entireProcessTree: true); }
        }

        async Task SendAsync(JsonObject message)
        {
            var json = message.ToJsonString();
            transcript.Add(new(true, json));
            await process.StandardInput.WriteLineAsync(json.AsMemory(), ct);
            await process.StandardInput.FlushAsync(ct);
        }

        async Task<JsonElement> RequestAsync(int id, string method, JsonObject parameters)
        {
            await SendAsync(new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = method, ["params"] = parameters });
            while (true)
            {
                var line = await process.StandardOutput.ReadLineAsync(ct)
                    ?? throw new InvalidOperationException($"The MCP server closed its output before answering '{method}'.");
                if (string.IsNullOrWhiteSpace(line)) continue;
                transcript.Add(new(false, line));
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                if (!root.TryGetProperty("id", out var rid) || rid.ValueKind != JsonValueKind.Number || rid.GetInt32() != id) continue; // notifications
                if (root.TryGetProperty("error", out var error))
                    throw new InvalidOperationException($"MCP error for '{method}': {error.GetRawText()}");
                return root.GetProperty("result").Clone();
            }
        }
    }
}

/// <summary>Finds the built experimental/DotNet11Lab.Mcp server. Only this fixed path (or an explicit configured one) is ever started.</summary>
public static class McpServerLocator
{
    public const string ProjectRelativeDir = "experimental/DotNet11Lab.Mcp";
    public const string AssemblyName = "DotNet11Lab.Mcp";

    public static string? Find(string? configuredPath, params string[] searchRoots)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath))
            return File.Exists(configuredPath) ? Path.GetFullPath(configuredPath) : null;

#if DEBUG
        string[] configurations = ["Debug", "Release"];
#else
        string[] configurations = ["Release", "Debug"];
#endif
        foreach (var root in searchRoots.Append(AppContext.BaseDirectory).Where(r => !string.IsNullOrEmpty(r)))
        {
            for (var dir = new DirectoryInfo(root); dir is not null; dir = dir.Parent)
            {
                if (!File.Exists(Path.Combine(dir.FullName, "DotNet11Lab.slnx"))) continue;
                foreach (var configuration in configurations)
                {
                    var dll = Path.Combine(dir.FullName, ProjectRelativeDir, "bin", configuration, "net11.0", AssemblyName + ".dll");
                    if (File.Exists(dll)) return dll;
                }
                break;
            }
        }
        return null;
    }

    /// <summary>Runs a .dll through the current 'dotnet' host; anything else is treated as an executable.</summary>
    public static ProcessStartInfo CreateStartInfo(string serverPath, params string[] extraArguments)
    {
        ProcessStartInfo info;
        if (serverPath.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
        {
            info = new ProcessStartInfo(DotnetHost());
            info.ArgumentList.Add(serverPath);
        }
        else
        {
            info = new ProcessStartInfo(serverPath);
        }
        foreach (var a in extraArguments) info.ArgumentList.Add(a);
        return info;
    }

    private static string DotnetHost()
    {
        var exe = OperatingSystem.IsWindows() ? "dotnet.exe" : "dotnet";
        // Under 'dotnet run/test' the current process is often the host itself; otherwise use DOTNET_ROOT or PATH.
        if (Path.GetFileName(Environment.ProcessPath) is { } name && name.Equals(exe, StringComparison.OrdinalIgnoreCase)) return Environment.ProcessPath!;
        if (Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") is { Length: > 0 } hostPath && File.Exists(hostPath)) return hostPath;
        if (Environment.GetEnvironmentVariable("DOTNET_ROOT") is { Length: > 0 } root && File.Exists(Path.Combine(root, exe))) return Path.Combine(root, exe);
        return exe;
    }
}
