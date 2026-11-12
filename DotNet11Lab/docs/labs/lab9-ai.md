# Lab 9: AI Integration (optional module)

Page: `/labs/ai` (`src/DotNet11Lab.Web/Components/Pages/Labs/AiLab.razor`, InteractiveServer).
Logic: `src/DotNet11Lab.Core/Labs/Ai/`. MCP server sample: `experimental/DotNet11Lab.Mcp/`.
Tests: `tests/DotNet11Lab.Tests/Lab9Ai/`.

The lab runs fully offline. With no configuration it uses a **Mock (offline, deterministic)** `IChatClient`: a
rule-based assistant over the lab catalog, labelled as such everywhere. It is not a language model, but it speaks
the real Microsoft.Extensions.AI protocol (tool calls, tool results, streaming, JSON output), so the real middleware
runs against it.

## What's new

| Item | Status (verified in this repo) |
|---|---|
| `Microsoft.Extensions.AI` / `.Abstractions` / `.OpenAI` **11.0.0** | Stable, released with .NET 11. `IChatClient`, `ChatClientBuilder`, `UseFunctionInvocation`, `UseLogging`, `UseOpenTelemetry`, `AddChatClient`/`AddKeyedChatClient`, `GetResponseAsync<T>` are not marked experimental. |
| New MEAI 11 types such as `FailoverChatClient`, `OrderedFailoverChatClient`, `SemanticRoutingChatClient`, `ReducingChatClient`, realtime and hosted-file clients | `[Experimental("MEAI001")]`; not used. |
| `ModelContextProtocol` **2.4.0** | Stable. `[McpServerToolType]`, `[McpServerTool(Name, ReadOnly, Idempotent, UseStructuredContent, ...)]`, `AddMcpServer().WithStdioServerTransport().WithTools(...)`, `McpClient.CreateAsync`, `StdioClientTransport`, `McpClientTool : AIFunction`. |
| `dotnet new mcpserver` | Bundled with SDK 11.0.100 (`dotnet new list mcp` → "MCP Server App"). The generated project references ModelContextProtocol **2.1.0** and Microsoft.Extensions.Hosting 11.0.0 and sets `PackageType=McpServer`, `PackAsTool`, self-contained single-file publish. |
| `Microsoft.AspNetCore.Components.AI` 11.0.0-preview.7.26425.128 | **Experimental**, prerelease only. Not referenced (see below). |

## Why it matters

- One abstraction (`IChatClient`) for OpenAI, Azure OpenAI, Ollama and any OpenAI-compatible server; switching is
  configuration.
- Cross-cutting behaviour is middleware: the tool loop (`FunctionInvokingChatClient`), logging and OpenTelemetry
  `gen_ai.*` spans/metrics are composed once with `ChatClientBuilder`.
- `AIFunctionFactory.Create` turns ordinary methods into tools with a generated JSON schema.
- `GetResponseAsync<T>` gives typed results without hand-written JSON parsing.
- MCP tools are `AIFunction`s, so tools from another process plug into the same pipeline.

## Example (what the lab runs)

```csharp
services.Configure<AiOptions>(configuration.GetSection("Ai"));
services.AddChatClient(sp => AiProviderFactory.CreateInnerClient(sp.GetRequiredService<IOptions<AiOptions>>().Value))
    .UseLogging()
    .UseFunctionInvocation(configure: f => { f.MaximumIterationsPerRequest = 4; f.IncludeDetailedErrors = false; })
    .UseOpenTelemetry(sourceName: "DotNet11Lab", configure: o => o.EnableSensitiveData = false);
services.AddKeyedChatClient("mock", new LabAssistantChatClient()).UseLabMiddleware();

var response = await chatClient.GetResponseAsync("What's new in lab 6?",
    new ChatOptions { Tools = [.. LabAiTools.CreateFunctions()] }, ct);
```

Tools (`LabAiTools`): `get_lab_features`, `search_features`, `measure_zstandard` (real `ZstandardStream` vs GZip/Brotli,
input capped at 64 KiB, quality clamped 1–22), `get_runtime_info`, `reconcile_transactions` (`Enumerable.FullJoin`,
max 200 entries per side). The page shows each tool call and its result as they stream, the middleware chain read from
the built pipeline, structured output into `FeatureSummary`, and a live MCP stdio probe.

### Configuring a real provider

`Ai` section: `Provider` = `Mock` (default) | `OpenAI` | `AzureOpenAI` | `OpenAICompatible`, plus `Model`, `Endpoint`.
The key comes only from `Ai:ApiKey` via user secrets or the `Ai__ApiKey` environment variable.

```bash
# OpenAI
export Ai__Provider=OpenAI Ai__Model=gpt-4o-mini Ai__ApiKey=<key>
# Ollama
export Ai__Provider=OpenAICompatible Ai__Endpoint=http://localhost:11434/v1 Ai__Model=llama3.2
# Azure OpenAI (v1 API; Model = deployment name)
export Ai__Provider=AzureOpenAI Ai__Endpoint=https://<resource>.openai.azure.com/openai/v1/ Ai__Model=<deployment> Ai__ApiKey=<key>
```

Misconfiguration (missing key, endpoint or model) does not stop the app: the page shows the problem and uses the
mock for the session. Runtime failures (401, 404, unreachable host) are rewritten into a short message with the key
masked, and the user can switch to the mock for the session.

## Previous approach

Calling a provider SDK directly (`OpenAI.Chat.ChatClient.CompleteChatAsync` with `ChatTool.CreateFunctionTool` and
a hand-written loop over `ChatFinishReason.ToolCalls`). The lab keeps this as compiled code
(`Labs/Ai/PreviousApproach/DirectOpenAiAssistant.cs`) that is **never executed** (it needs a live endpoint), shown next
to the `IChatClient` version.

## MCP

`experimental/DotNet11Lab.Mcp` is a stdio MCP server (`dotnet run --project experimental/DotNet11Lab.Mcp`) exposing
four lab tools. `--client-demo` starts it as a child process with `McpClient`/`StdioClientTransport`, passes the
`McpClientTool`s (which derive from `AIFunction`) into `ChatOptions.Tools`, and lets the mock call them through
`FunctionInvokingChatClient`. The tool type and client bridge live in `Core/Labs/Ai/Mcp/*.cs` behind
`#if DOTNET11LAB_MCP` so the page can display their source while Core takes no MCP dependency. The dashboard's probe
speaks raw JSON-RPC (initialize, notifications/initialized, tools/list, tools/call) to show the wire format.

VS Code (`.vscode/mcp.json`):

```json
{ "servers": { "dotnet11lab": { "type": "stdio", "command": "dotnet", "args": ["run", "--project", "experimental/DotNet11Lab.Mcp"] } } }
```

## Experimental: Blazor AI components

`Microsoft.AspNetCore.Components.AI` 11.0.0-preview.7.26425.128 was restored in a throwaway project and its XML docs
inspected. Public components: `ChatPage`, `AgentBoundary`, `MessageList`, `MessageInput`, `BlockRenderer<TBlock>`;
runtime types `UIAgent` (ctor takes an `IChatClient`, optional `ChatOptions` or `Action<UIAgentOptions>`;
`SendMessageAsync`), `UIAgentOptions` (`ChatOptions`, `AddBlockHandler<T>`), `AgentContext` (`Turns`, `Status`),
`ConversationStatus` (Idle, Streaming, AwaitingInput, Error), `RichContentBlock` plus a Markdown node model; stylesheet
`ai-chat.css`. Types mentioned in earlier docs (function-invocation/approval blocks, `UIAgent<TState>`, `[ToolBlock]`
source generation) are **absent** from this package.

Not used because: it is prerelease and documented as possibly never shipping stable; it depends on
`Microsoft.AspNetCore.Components.Web 11.0.0-rc.1` and `Microsoft.Extensions.AI.Abstractions 10.6.0`; and restore
reports **NU1902** (known moderate vulnerability in `Microsoft.Extensions.Validation 11.0.0-rc.1`), which fails a
warnings-as-errors build. No `experimental/DotNet11Lab.BlazorAi` sample was created for that reason.

## Production use cases

Support assistants grounded in your own APIs via tools; typed extraction from documents; IDE/agent integrations via
MCP servers; provider failover or local models (Ollama) for privacy-sensitive workloads; deterministic mock clients in
CI.

## When not to use

Deterministic business rules; provider-only features the abstraction does not model (use `GetService<T>()` /
`RawRepresentation` for that call); destructive tools without human approval; the Blazor AI components in production
while prerelease.

## Security notes

- **Keys**: configuration only (user secrets, environment, a vault); never in `appsettings.json` or source. The UI
  only shows "API key configured: yes/no". `OpenTelemetryChatClient.EnableSensitiveData` is off, and `LoggingChatClient`
  logs content only at Trace.
- **Prompt injection with tools**: tool arguments are chosen by the model and tool output (including MCP results and
  any web/document content) can contain instructions. Treat arguments as untrusted input (validate, cap sizes), keep
  tools read-only where possible, bound the loop (`MaximumIterationsPerRequest`), keep `IncludeDetailedErrors` off,
  and require approval for side effects.
- **MCP**: an MCP server runs with the launching user's rights. Only start servers you trust; the dashboard starts
  only the fixed, locally built `DotNet11Lab.Mcp` (or an explicitly configured `Ai:McpServerPath`).

## Official documentation

- Microsoft.Extensions.AI: https://learn.microsoft.com/dotnet/ai/microsoft-extensions-ai
- Tool calling: https://learn.microsoft.com/dotnet/ai/conceptual/calling-tools
- Structured output: https://learn.microsoft.com/dotnet/ai/quickstarts/structured-output
- Get started with MCP in .NET: https://learn.microsoft.com/dotnet/ai/get-started-mcp
- Build an MCP server: https://learn.microsoft.com/dotnet/ai/quickstarts/build-mcp-server
- MCP C# SDK: https://github.com/modelcontextprotocol/csharp-sdk
- Blazor AI components (experimental): https://learn.microsoft.com/aspnet/core/blazor/components/ai-components?view=aspnetcore-11.0
- Safe storage of app secrets: https://learn.microsoft.com/aspnet/core/security/app-secrets
