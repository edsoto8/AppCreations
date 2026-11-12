using System.Text;
using System.Text.Json;
using DotNet11Lab.Core.Labs.Ai;
using DotNet11Lab.Core.Labs.Ai.Mcp;
using Microsoft.Extensions.AI;

namespace DotNet11Lab.Web.Components.Pages.Labs;

public partial class AiLab
{
    private const int MaxPromptChars = 1000;

    private enum EntryKind { User, Assistant, ToolCall, ToolResult, Error, Note }

    private sealed class Entry(EntryKind kind, string text, string? toolName = null, bool mock = false)
    {
        public EntryKind Kind { get; } = kind;
        public StringBuilder Buffer { get; } = new(text);
        public string Text => Buffer.ToString();
        public string? ToolName { get; } = toolName;
        public bool Mock { get; } = mock;
    }

    private static readonly string[] Suggestions =
    [
        "What's new in lab 6?",
        "Compress 'the quick brown fox jumps over the lazy dog, the quick brown fox jumps again' with zstandard at quality 19",
        "Reconcile the sample transactions",
        "Which runtime am I running on?",
        "Search for json",
        "Tell me about union types",
    ];

    private static readonly (string Key, string Label)[] CodeTabs =
    [
        ("di", "DI & middleware"), ("mock", "Mock client"), ("tools", "Tools"), ("stream", "Streaming turn"), ("before", "Previous approach"),
    ];

    private readonly List<Entry> _entries = [];
    private List<ChatMessage> _history = LabAssistant.NewConversation();
    private IReadOnlyList<PipelineStage> _pipeline = [];
    private CancellationTokenSource? _cts;
    private string _prompt = "";
    private bool _busy, _forceMock, _useTools = true;
    private string _codeTab = "di";

    private string _featureQuery = "Zstandard compression";
    private FeatureSummary? _summary;
    private string? _summaryJson;

    private int _mcpLab = 9;
    private string? _mcpServerPath;
    private McpProbeResult? _mcp;

    private AiProviderStatus Status => Assistant.Status;

    /// <summary>Misconfigured real providers fall back to the mock automatically for the session.</summary>
    private bool UsingMock => Status.IsMock || _forceMock;

    private string? ActiveModel => UsingMock ? LabAssistantChatClient.ModelId : Status.Model;

    protected override void OnInitialized()
    {
        _forceMock = !Status.IsUsable;
        _pipeline = Assistant.DescribePipeline(_forceMock);
        _mcpServerPath = McpServerLocator.Find(AiOptionsAccessor.Value.McpServerPath, Environment.ContentRootPath);
    }

    private void SetForceMock(bool value)
    {
        _forceMock = value || !Status.IsUsable;
        _pipeline = Assistant.DescribePipeline(_forceMock);
        _entries.Add(new(EntryKind.Note, _forceMock ? "Switched to the mock (offline, deterministic) for this session." : $"Switched back to {Status.DisplayName}."));
    }

    private void Clear()
    {
        _entries.Clear();
        _history = LabAssistant.NewConversation();
    }

    private async Task SendAsync(string prompt)
    {
        prompt = prompt.Trim();
        if (_busy || prompt.Length == 0) return;
        if (prompt.Length > MaxPromptChars) prompt = prompt[..MaxPromptChars];

        _prompt = "";
        _busy = true;
        _cts?.Dispose();
        _cts = new CancellationTokenSource();
        _entries.Add(new(EntryKind.User, prompt));
        var mock = UsingMock;
        Entry? current = null;

        try
        {
            await foreach (var e in Assistant.StreamTurnAsync(_history, prompt, mock, _useTools, _cts.Token))
            {
                switch (e.Kind)
                {
                    case AiTurnEventKind.Text:
                        if (current is null)
                        {
                            current = new Entry(EntryKind.Assistant, "", mock: mock);
                            _entries.Add(current);
                        }
                        current.Buffer.Append(e.Text);
                        break;
                    case AiTurnEventKind.ToolCall:
                        _entries.Add(new(EntryKind.ToolCall, e.Text, e.ToolName));
                        current = null;
                        break;
                    case AiTurnEventKind.ToolResult:
                        _entries.Add(new(EntryKind.ToolResult, e.Text, e.ToolName));
                        current = null;
                        break;
                }
                StateHasChanged();
            }
        }
        catch (OperationCanceledException) when (_cts.IsCancellationRequested)
        {
            _entries.Add(new(EntryKind.Note, "Cancelled. The CancellationToken was passed through the whole pipeline."));
        }
        catch (Exception ex)
        {
            _entries.Add(new(EntryKind.Error, Assistant.DescribeFailure(ex)));
        }
        finally
        {
            _busy = false;
        }
    }

    private void Cancel() => _cts?.Cancel();

    public void Dispose()
    {
        _cts?.Cancel();
        _cts?.Dispose();
    }

    private async Task RunStructuredAsync(CancellationToken cancellationToken)
    {
        _summary = null;
        _summaryJson = null;
        var response = await FeatureSummaryExtractor.ExtractAsync(Assistant.GetClient(UsingMock), _featureQuery, cancellationToken);
        _summaryJson = Pretty(response.Text);
        _summary = response.TryGetResult(out var result) ? result : null;
    }

    private async Task RunMcpProbeAsync(CancellationToken cancellationToken)
    {
        _mcp = null;
        _mcpServerPath = McpServerLocator.Find(AiOptionsAccessor.Value.McpServerPath, Environment.ContentRootPath)
            ?? throw new InvalidOperationException("The MCP server is not built. Run 'dotnet build DotNet11Lab.slnx' (or set Ai:McpServerPath) and try again.");
        _mcp = await McpStdioProbe.RunAsync(_mcpServerPath, _mcpLab, cancellationToken);
    }

    private static IEnumerable<string> Parameters(AIFunction tool) =>
        tool.JsonSchema.TryGetProperty("properties", out var props) && props.ValueKind == JsonValueKind.Object
            ? props.EnumerateObject().Select(p => p.Name)
            : [];

    private static string Pretty(string json)
    {
        try { return JsonSerializer.Serialize(JsonDocument.Parse(json).RootElement, IndentedJson); }
        catch (JsonException) { return json; }
    }

    private static string Abbreviate(string json) => json.Length > 600 ? json[..600] + " …" : json;

    private static readonly JsonSerializerOptions IndentedJson = new() { WriteIndented = true };

    private const string OpenAiConfig = """
        # appsettings.json (or environment): choose the provider
        #   "Ai": { "Provider": "OpenAI", "Model": "gpt-4o-mini" }
        # the key never goes in appsettings.json:
        export Ai__Provider=OpenAI
        export Ai__ApiKey=<your key>     # or: dotnet user-secrets set "Ai:ApiKey" "<your key>"
        dotnet run --project src/DotNet11Lab.Web
        """;

    private const string CompatibleConfig = """
        # Ollama (no key needed)
        export Ai__Provider=OpenAICompatible
        export Ai__Endpoint=http://localhost:11434/v1
        export Ai__Model=llama3.2

        # Azure OpenAI (v1 API; Model = deployment name)
        export Ai__Provider=AzureOpenAI
        export Ai__Endpoint=https://<resource>.openai.azure.com/openai/v1/
        export Ai__Model=<deployment>
        export Ai__ApiKey=<your key>
        """;

    private const string McpCommands = """
        dotnet build DotNet11Lab.slnx
        # run the server (an MCP host would launch this command and talk over stdio)
        dotnet run --project experimental/DotNet11Lab.Mcp
        # MCP client demo: McpClient -> McpClientTool (an AIFunction) -> FunctionInvokingChatClient -> mock
        dotnet run --project experimental/DotNet11Lab.Mcp -- --client-demo "What's new in lab 6?"
        # VS Code .vscode/mcp.json
        { "servers": { "dotnet11lab": { "type": "stdio", "command": "dotnet",
            "args": ["run", "--project", "experimental/DotNet11Lab.Mcp"] } } }
        # scaffold your own server (template bundled with SDK 11)
        dotnet new mcpserver -n MyMcpServer
        """;

    private const string BlazorAiSample = """
        @* dotnet add package Microsoft.AspNetCore.Components.AI --prerelease *@
        @inject IChatClient ChatClient

        <ChatPage Agent="agent" Placeholder="Ask me anything" />

        @code {
            private UIAgent agent = default!;

            // UIAgent(IChatClient, ChatOptions): the same IChatClient pipeline and tools as above.
            protected override void OnInitialized() =>
                agent = new UIAgent(ChatClient, new ChatOptions { Tools = [.. LabAiTools.CreateFunctions()] });
        }
        """;
}
