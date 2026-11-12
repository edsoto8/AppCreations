// This file is COMPILED BY experimental/DotNet11Lab.Mcp (which defines DOTNET11LAB_MCP and references the
// ModelContextProtocol package). It lives under Core only so its source is embedded and shown on the AI lab page:
// in DotNet11Lab.Core the symbol is undefined, the body is empty and Core takes no MCP dependency.
#if DOTNET11LAB_MCP
using System.ComponentModel;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace DotNet11Lab.Core.Labs.Ai.Mcp;

// <snippet:Ai.McpServerTools>
/// <summary>The same lab tools, exposed over the Model Context Protocol. Any MCP client (VS Code, Claude, Copilot,
/// another .NET app) can list and call them.</summary>
[McpServerToolType]
public static class LabMcpTools
{
    [McpServerTool(Name = LabAiTools.GetLabFeaturesName, ReadOnly = true, Idempotent = true, UseStructuredContent = true)]
    [Description("Lists the .NET 11 features demonstrated by one DotNet 11 Lab laboratory (1-9).")]
    public static LabFeaturesResult GetLabFeatures([Description("Lab number, 1 to 9.")] int labNumber) =>
        LabAiTools.GetLabFeatures(labNumber);

    [McpServerTool(Name = LabAiTools.SearchFeaturesName, ReadOnly = true, Idempotent = true)]
    [Description("Searches the lab catalog for .NET 11 features whose name or summary contains the query.")]
    public static IReadOnlyList<FeatureDto> SearchFeatures([Description("Words to look for.")] string query) =>
        LabAiTools.SearchFeatures(query);

    [McpServerTool(Name = LabAiTools.MeasureZstandardName, ReadOnly = true, UseStructuredContent = true)]
    [Description("Compresses text with ZstandardStream (new in .NET 11) and compares it with GZip and Brotli.")]
    public static CompressionResult MeasureZstandard(
        [Description("Text to compress; omit for a built-in sample.")] string? text = null,
        [Description("Quality 1-22.")] int quality = 3) =>
        LabAiTools.MeasureZstandard(text, quality);

    [McpServerTool(Name = LabAiTools.GetRuntimeInfoName, ReadOnly = true, UseStructuredContent = true)]
    [Description("Reports the .NET runtime, OS, architecture and GC mode of the MCP server process.")]
    public static RuntimeInfoResult GetRuntimeInfo() => LabAiTools.GetRuntimeInfo();
}
// </snippet:Ai.McpServerTools>

public static class LabMcpServerRegistration
{
    // <snippet:Ai.McpServerHost>
    /// <summary>Registers the MCP server: stdio transport (the host reads stdin and writes stdout) plus the tool type.</summary>
    public static IMcpServerBuilder AddLabMcpServer(this IServiceCollection services) => services
        .AddMcpServer(o => o.ServerInfo = new Implementation { Name = "dotnet11lab-mcp", Version = "1.0.0" })
        .WithStdioServerTransport()
        .WithTools([typeof(LabMcpTools)]);
    // </snippet:Ai.McpServerHost>
}
#endif
