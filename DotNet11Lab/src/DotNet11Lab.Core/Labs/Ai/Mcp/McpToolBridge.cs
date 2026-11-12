// Compiled by experimental/DotNet11Lab.Mcp only (see LabMcpTools.cs for why it lives here).
#if DOTNET11LAB_MCP
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;

namespace DotNet11Lab.Core.Labs.Ai.Mcp;

/// <summary>
/// The client side: connect to an MCP server over stdio and hand its tools to an <see cref="IChatClient"/>.
/// <see cref="McpClientTool"/> derives from <see cref="AIFunction"/>, so no adapter is needed.
/// </summary>
public static class McpToolBridge
{
    // <snippet:Ai.McpClientBridge>
    public static async Task<string> AskWithMcpToolsAsync(string command, IList<string> arguments, string question,
        IChatClient chatClient, TextWriter log, CancellationToken cancellationToken)
    {
        var transport = new StdioClientTransport(new StdioClientTransportOptions
        {
            Name = "dotnet11lab-mcp",
            Command = command,
            Arguments = arguments,
        });
        await using var mcp = await McpClient.CreateAsync(transport, cancellationToken: cancellationToken);
        log.WriteLine($"connected to {mcp.ServerInfo?.Name} {mcp.ServerInfo?.Version}");

        IList<McpClientTool> tools = await mcp.ListToolsAsync(cancellationToken: cancellationToken);
        foreach (var tool in tools) log.WriteLine($"tool: {tool.Name} - {tool.Description}");

        // McpClientTool : AIFunction, so the tools drop straight into ChatOptions.Tools.
        using var pipeline = new ChatClientBuilder(chatClient).UseFunctionInvocation().Build();
        var response = await pipeline.GetResponseAsync(question, new ChatOptions { Tools = [.. tools] }, cancellationToken);

        foreach (var call in response.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>())
            log.WriteLine($"model called: {call.Name}");
        return response.Text;
    }
    // </snippet:Ai.McpClientBridge>
}
#endif
