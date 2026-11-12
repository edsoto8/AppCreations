using DotNet11Lab.Core.Diagnostics;
using DotNet11Lab.Core.Labs.Ai;
using DotNet11Lab.Tests.Lab9Ai;
using DotNet11Lab.Web.Labs.AspNetCore;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Review;

/// <summary>Regression tests for defects found in the final code review.</summary>
public class ReviewRegressionTests
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;

    // --- SSRF: the playground's target host never comes from the client ---

    [Theory]
    [InlineData("http://+:5180", "http://localhost:5180/")]
    [InlineData("http://*:8080", "http://localhost:8080/")]
    [InlineData("http://0.0.0.0:5180", "http://localhost:5180/")]
    [InlineData("http://[::]:5180", "http://localhost:5180/")]
    [InlineData("http://127.0.0.1:5191", "http://127.0.0.1:5191/")]
    public void Playground_targets_the_servers_own_bound_address(string bound, string expected)
    {
        Assert.Equal(new Uri(expected), ApiPlaygroundClient.ResolveBaseAddress(null, [bound]));
    }

    [Fact]
    public void Playground_prefers_http_binding_and_honours_configuration()
    {
        Assert.Equal(new Uri("http://localhost:5000/"), ApiPlaygroundClient.ResolveBaseAddress(null, ["https://localhost:5001", "http://localhost:5000"]));
        Assert.Equal(new Uri("http://api.internal:9000/"), ApiPlaygroundClient.ResolveBaseAddress("http://api.internal:9000", ["http://localhost:5000"]));
    }

    [Theory]
    [InlineData("file:///etc/passwd")]
    [InlineData("not a uri")]
    public void Playground_rejects_non_http_configuration(string configured)
    {
        Assert.Null(ApiPlaygroundClient.ResolveBaseAddress(configured, ["http://localhost:5000"]));
    }

    [Fact]
    public void Playground_without_any_known_address_resolves_to_null()
    {
        Assert.Null(ApiPlaygroundClient.ResolveBaseAddress(null, []));
    }

    [Theory]
    [InlineData("http://evil.example/api/x")]
    [InlineData("//evil.example/api/x")]
    [InlineData("/api/../admin")]
    [InlineData("/admin")]
    public void Playground_rejects_paths_that_could_leave_the_api(string path)
    {
        Assert.NotNull(ApiPlaygroundClient.ValidateRequest("GET", path, null));
    }

    // --- AI: failed turns are rolled back and history is bounded ---

    [Fact]
    public async Task Cancelled_turn_leaves_no_orphaned_user_message()
    {
        using var services = PipelineTests.BuildServices();
        var assistant = services.GetRequiredService<LabAssistant>();
        var history = LabAssistant.NewConversation();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(Ct);
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
        {
            await foreach (var _ in assistant.StreamTurnAsync(history, "What is new in lab 1?", forceMock: true, useTools: true, cts.Token)) { }
        });

        Assert.Single(history); // only the system prompt
    }

    [Fact]
    public async Task Oversized_prompt_is_rejected_server_side()
    {
        using var services = PipelineTests.BuildServices();
        var assistant = services.GetRequiredService<LabAssistant>();
        var history = LabAssistant.NewConversation();

        await Assert.ThrowsAsync<ArgumentException>(async () =>
        {
            await foreach (var _ in assistant.StreamTurnAsync(history, new string('x', LabAssistant.MaxPromptChars + 1), true, false, Ct)) { }
        });
        Assert.Single(history);
    }

    [Fact]
    public void TrimHistory_keeps_system_prompt_and_cuts_only_at_user_turns()
    {
        var history = LabAssistant.NewConversation();
        for (var turn = 0; turn < 10; turn++)
        {
            history.Add(new ChatMessage(ChatRole.User, $"q{turn}"));
            history.Add(new ChatMessage(ChatRole.Assistant, [new FunctionCallContent($"c{turn}", "tool")]));
            history.Add(new ChatMessage(ChatRole.Tool, [new FunctionResultContent($"c{turn}", "ok")]));
            history.Add(new ChatMessage(ChatRole.Assistant, $"a{turn}"));
        }

        LabAssistant.TrimHistory(history, maxMessages: 13);

        Assert.True(history.Count <= 13);
        Assert.Equal(ChatRole.System, history[0].Role);
        Assert.Equal(ChatRole.User, history[1].Role);
        Assert.Equal("q9", history.Last(m => m.Role == ChatRole.User).Text);
    }

    // --- Measurements state what their allocation counter covers ---

    [Fact]
    public async Task Measurements_report_their_allocation_scope()
    {
        var sync = Measure.Run("sync", 3, () => _ = new byte[16], Ct);
        var async = await Measure.RunAsync("async", 3, () => Task.CompletedTask, Ct);

        Assert.Equal(AllocationScope.Thread, sync.Scope);
        Assert.Equal(AllocationScope.Process, async.Scope);
    }
}
