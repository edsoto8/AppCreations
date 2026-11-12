using System.Reflection;
using DotNet11Lab.Core.Labs.Ai;
using DotNet11Lab.Core.Labs.Ai.Mcp;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

// Usage:
//   dotnet run --project experimental/DotNet11Lab.Mcp                      -> stdio MCP server (what MCP hosts launch)
//   dotnet run --project experimental/DotNet11Lab.Mcp -- --client-demo [q]  -> MCP client: starts this server as a
//       child process, turns its tools into AIFunctions and lets the offline mock IChatClient call them.
if (args is ["--client-demo", .. var rest])
{
    var question = rest.Length > 0 ? string.Join(' ', rest) : "What's new in lab 6?";
    var self = Assembly.GetExecutingAssembly().Location;
    var start = McpServerLocator.CreateStartInfo(self);
    using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
    var answer = await McpToolBridge.AskWithMcpToolsAsync(start.FileName, [.. start.ArgumentList], question,
        new LabAssistantChatClient(TimeSpan.Zero), Console.Out, cts.Token);
    Console.WriteLine("answer: " + answer);
    return;
}

var builder = Host.CreateApplicationBuilder(args);

// stdout carries the protocol, so every log line must go to stderr.
builder.Logging.ClearProviders();
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);
builder.Logging.SetMinimumLevel(LogLevel.Warning);

builder.Services.AddLabMcpServer();

await builder.Build().RunAsync();
