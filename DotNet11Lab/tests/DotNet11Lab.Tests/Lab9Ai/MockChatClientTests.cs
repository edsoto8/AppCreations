using DotNet11Lab.Core.Labs.Ai;
using Microsoft.Extensions.AI;

namespace DotNet11Lab.Tests.Lab9Ai;

public class MockChatClientTests
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;
    private static LabAssistantChatClient NewClient() => new(TimeSpan.Zero);
    private static ChatOptions WithTools() => new() { Tools = [.. LabAiTools.CreateFunctions()] };

    [Fact]
    public async Task Answers_lab_questions_from_the_catalog()
    {
        var response = await NewClient().GetResponseAsync("What's new in lab 6?", cancellationToken: Ct);

        Assert.Contains("Library Features", response.Text, StringComparison.Ordinal);
        Assert.Contains("Zstandard compression", response.Text, StringComparison.Ordinal);
        Assert.Equal(ChatFinishReason.Stop, response.FinishReason);
        Assert.Equal(LabAssistantChatClient.ModelId, response.ModelId);
    }

    [Fact]
    public async Task Is_deterministic()
    {
        var a = await NewClient().GetResponseAsync("Tell me about union types", cancellationToken: Ct);
        var b = await NewClient().GetResponseAsync("Tell me about union types", cancellationToken: Ct);
        Assert.Equal(a.Text, b.Text);
        Assert.Contains("Union types", a.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Streams_several_chunks_that_add_up_to_the_full_answer()
    {
        var client = NewClient();
        var expected = (await client.GetResponseAsync("What's new in lab 1?", cancellationToken: Ct)).Text;

        var chunks = new List<string>();
        await foreach (var update in client.GetStreamingResponseAsync("What's new in lab 1?", cancellationToken: Ct))
            if (update.Text.Length > 0) chunks.Add(update.Text);

        Assert.True(chunks.Count > 10, $"expected many chunks, got {chunks.Count}");
        Assert.Equal(expected, string.Concat(chunks));
    }

    [Theory]
    [InlineData("What's new in lab 6?", LabAiTools.GetLabFeaturesName)]
    [InlineData("Compress 'hello hello hello hello' with zstandard at quality 9", LabAiTools.MeasureZstandardName)]
    [InlineData("Reconcile the sample transactions", LabAiTools.ReconcileName)]
    [InlineData("Which runtime am I running on?", LabAiTools.GetRuntimeInfoName)]
    [InlineData("Search for json lines", LabAiTools.SearchFeaturesName)]
    public async Task Emits_a_function_call_when_a_matching_tool_is_offered(string prompt, string tool)
    {
        var response = await NewClient().GetResponseAsync(prompt, WithTools(), Ct);

        var call = Assert.Single(response.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>());
        Assert.Equal(tool, call.Name);
        Assert.Equal(ChatFinishReason.ToolCalls, response.FinishReason);
    }

    [Fact]
    public async Task Extracts_tool_arguments_from_the_prompt()
    {
        var compress = await NewClient().GetResponseAsync("Compress 'abc abc abc' with zstd level 7", WithTools(), Ct);
        var call = compress.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>().Single();
        Assert.Equal("abc abc abc", call.Arguments!["text"]);
        Assert.Equal(7, call.Arguments["quality"]);

        var lab = await NewClient().GetResponseAsync("what's new in lab 9", WithTools(), Ct);
        Assert.Equal(9, lab.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>().Single().Arguments!["labNumber"]);
    }

    [Fact]
    public async Task Does_not_call_tools_that_were_not_offered()
    {
        var response = await NewClient().GetResponseAsync("Compress 'x' with zstandard", cancellationToken: Ct);
        Assert.Empty(response.Messages.SelectMany(m => m.Contents).OfType<FunctionCallContent>());
        Assert.NotEmpty(response.Text);
    }

    [Fact]
    public async Task Streams_the_function_call_as_an_update()
    {
        var updates = new List<ChatResponseUpdate>();
        await foreach (var u in NewClient().GetStreamingResponseAsync("Reconcile please", WithTools(), Ct)) updates.Add(u);

        var call = Assert.Single(updates.SelectMany(u => u.Contents).OfType<FunctionCallContent>());
        Assert.Equal(LabAiTools.ReconcileName, call.Name);
    }

    [Fact]
    public async Task Summarises_function_results_on_the_second_round_trip()
    {
        var call = new FunctionCallContent("call_1", LabAiTools.GetLabFeaturesName, new Dictionary<string, object?> { ["labNumber"] = 2 });
        List<ChatMessage> history =
        [
            new(ChatRole.User, "What's new in lab 2?"),
            new(ChatRole.Assistant, [call]),
            new(ChatRole.Tool, [new FunctionResultContent("call_1", LabAiTools.GetLabFeatures(2))]),
        ];

        var response = await NewClient().GetResponseAsync(history, WithTools(), Ct);

        Assert.Contains("I called `get_lab_features`", response.Text, StringComparison.Ordinal);
        Assert.Contains("Enumerable.FullJoin", response.Text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Honours_cancellation_while_streaming()
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        var client = new LabAssistantChatClient(TimeSpan.FromMilliseconds(5));
        var received = 0;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await foreach (var _ in client.GetStreamingResponseAsync("What's new in lab 3?", cancellationToken: cts.Token))
                if (++received == 3) await cts.CancelAsync();
        });
        Assert.Equal(3, received);
    }

    [Fact]
    public void Exposes_metadata_identifying_it_as_the_mock()
    {
        var metadata = NewClient().GetService<ChatClientMetadata>();
        Assert.NotNull(metadata);
        Assert.Equal(LabAssistantChatClient.ProviderName, metadata.ProviderName);
    }
}
