using DotNet11Lab.Core;
using DotNet11Lab.Core.Labs.Ai;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab9Ai;

public class PipelineTests
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;

    internal static ServiceProvider BuildServices(Dictionary<string, string?>? settings = null)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings ?? []).Build();
        return new ServiceCollection().AddLogging().AddLabCore(configuration).BuildServiceProvider();
    }

    [Fact]
    public async Task Function_invocation_middleware_really_invokes_the_tool()
    {
        var invoked = 0;
        var tool = AIFunctionFactory.Create((int labNumber) => { invoked++; return LabAiTools.GetLabFeatures(labNumber); },
            LabAiTools.GetLabFeaturesName, "Lab features");
        using var client = new ChatClientBuilder(new LabAssistantChatClient(TimeSpan.Zero)).UseFunctionInvocation().Build();

        var response = await client.GetResponseAsync("What's new in lab 4?", new ChatOptions { Tools = [tool] }, Ct);

        Assert.Equal(1, invoked);
        var contents = response.Messages.SelectMany(m => m.Contents).ToList();
        Assert.Single(contents.OfType<FunctionCallContent>());
        Assert.Single(contents.OfType<FunctionResultContent>());
        Assert.Contains("I called `get_lab_features`", response.Text, StringComparison.Ordinal);
        Assert.Contains("QuickGrid", response.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Di_pipeline_runs_the_real_zstandard_tool()
    {
        using var services = BuildServices();
        var client = services.GetRequiredService<IChatClient>();

        var response = await client.GetResponseAsync("Compress the sample with zstandard",
            new ChatOptions { Tools = [.. LabAiTools.CreateFunctions()] }, Ct);

        var result = response.Messages.SelectMany(m => m.Contents).OfType<FunctionResultContent>().Single();
        Assert.Null(result.Exception);
        Assert.Contains("Zstandard (quality 3) produced", response.Text, StringComparison.Ordinal);
        Assert.Contains("Round-trip verified: yes", response.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Streaming_turn_reports_tool_call_result_and_text_and_keeps_history()
    {
        using var services = BuildServices();
        var assistant = services.GetRequiredService<LabAssistant>();
        var history = LabAssistant.NewConversation();

        var events = new List<AiTurnEvent>();
        await foreach (var e in assistant.StreamTurnAsync(history, "Reconcile the sample transactions", forceMock: false, useTools: true, Ct))
            events.Add(e);

        Assert.Equal(AiTurnEventKind.ToolCall, events[0].Kind);
        Assert.Equal(LabAiTools.ReconcileName, events[0].ToolName);
        var result = Assert.Single(events, e => e.Kind == AiTurnEventKind.ToolResult);
        Assert.Equal(LabAiTools.ReconcileName, result.ToolName);
        Assert.Contains("\"matched\"", result.Text, StringComparison.Ordinal);
        var text = string.Concat(events.Where(e => e.Kind == AiTurnEventKind.Text).Select(e => e.Text));
        Assert.Contains("2 matched, 1 amount mismatch(es), 1 only in the bank, 1 only in the ledger", text, StringComparison.Ordinal);

        // system, user, assistant(call), tool(result), assistant(text)
        Assert.Equal(5, history.Count);
        Assert.Equal(ChatRole.Tool, history[3].Role);

        // A follow-up turn sees only its own messages and answers normally.
        var followUp = new List<AiTurnEvent>();
        await foreach (var e in assistant.StreamTurnAsync(history, "Tell me about union types", false, true, Ct)) followUp.Add(e);
        Assert.All(followUp, e => Assert.Equal(AiTurnEventKind.Text, e.Kind));
    }

    [Fact]
    public void Pipeline_description_is_read_from_the_built_chain()
    {
        using var services = BuildServices();
        var stages = services.GetRequiredService<LabAssistant>().DescribePipeline(forceMock: false);

        Assert.Equal(
            [nameof(LoggingChatClient), nameof(FunctionInvokingChatClient), nameof(OpenTelemetryChatClient), nameof(LabAssistantChatClient)],
            stages.Select(s => s.TypeName));
        Assert.Contains(LabAssistantChatClient.ProviderName, stages[^1].Detail, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Structured_output_returns_a_typed_feature_summary()
    {
        using var services = BuildServices();
        var client = services.GetRequiredService<IChatClient>();

        var response = await FeatureSummaryExtractor.ExtractAsync(client, "Zstandard compression", Ct);

        Assert.True(response.TryGetResult(out var summary));
        Assert.Equal("Zstandard compression", summary.Feature);
        Assert.Equal(6, summary.LabNumber);
        Assert.True(summary.NewInDotNet11);
        Assert.StartsWith("https://learn.microsoft.com", summary.DocsUrl, StringComparison.Ordinal);
    }
}
