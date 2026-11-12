using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace DotNet11Lab.Core.Labs.Ai;

public enum AiTurnEventKind { Text, ToolCall, ToolResult }

/// <summary>Something the transcript should show while a turn streams.</summary>
public sealed record AiTurnEvent(AiTurnEventKind Kind, string Text, string? ToolName = null, string? CallId = null);

/// <summary>
/// The page-facing service: picks the configured or the mock pipeline, supplies the tools and turns streamed
/// <see cref="ChatResponseUpdate"/>s into transcript events by inspecting their <see cref="AIContent"/>.
/// </summary>
public sealed class LabAssistant(
    IChatClient configured,
    [FromKeyedServices(LabAssistant.MockKey)] IChatClient mock,
    IOptions<AiOptions> options)
{
    public const string MockKey = "mock";
    private const int MaxDisplayChars = 4000;

    public const string SystemPrompt =
        "You are the DotNet 11 Lab assistant. Answer questions about the .NET 11 features demonstrated by the lab. "
        + "Prefer calling the provided tools for lab data, compression measurements, runtime details and reconciliation. Be concise.";

    public AiProviderStatus Status { get; } = AiProviderFactory.Describe(options.Value);

    public IReadOnlyList<AIFunction> Tools { get; } = LabAiTools.CreateFunctions();

    public IChatClient GetClient(bool forceMock) => forceMock && !Status.IsMock ? mock : configured;

    public IReadOnlyList<PipelineStage> DescribePipeline(bool forceMock) => AiPipeline.Describe(GetClient(forceMock));

    public string DescribeFailure(Exception ex) => AiProviderFactory.DescribeFailure(ex, options.Value);

    public static List<ChatMessage> NewConversation() => [new(ChatRole.System, SystemPrompt)];

    /// <summary>Longest prompt accepted from the UI (enforced server-side; the textarea's maxlength is only a hint).</summary>
    public const int MaxPromptChars = 4000;

    /// <summary>History kept per conversation; every turn resends it to the provider, so it must not grow unbounded.</summary>
    public const int MaxHistoryMessages = 40;

    /// <summary>
    /// Drops the oldest turns (never the system prompt) until the history fits, cutting only at user-message
    /// boundaries so a tool call is never separated from its result.
    /// </summary>
    public static void TrimHistory(List<ChatMessage> history, int maxMessages = MaxHistoryMessages)
    {
        var first = history.Count > 0 && history[0].Role == ChatRole.System ? 1 : 0;
        while (history.Count > maxMessages)
        {
            var nextUser = history.FindIndex(first + 1, m => m.Role == ChatRole.User);
            if (nextUser < 0) break;
            history.RemoveRange(first, nextUser - first);
        }
    }

    // <snippet:Ai.AbstractionAsk>
    /// <summary>Provider-neutral: the tool loop, tracing and logging all come from the middleware pipeline.</summary>
    public async Task<string> AskAsync(string question, bool forceMock, CancellationToken cancellationToken)
    {
        ChatResponse response = await GetClient(forceMock).GetResponseAsync(
            [new(ChatRole.System, SystemPrompt), new(ChatRole.User, question)],
            new ChatOptions { Tools = [.. Tools] },
            cancellationToken);
        return response.Text;
    }
    // </snippet:Ai.AbstractionAsk>

    // <snippet:Ai.StreamTurn>
    public async IAsyncEnumerable<AiTurnEvent> StreamTurnAsync(List<ChatMessage> history, string prompt, bool forceMock, bool useTools,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prompt);
        if (prompt.Length > MaxPromptChars) throw new ArgumentException($"Prompts are limited to {MaxPromptChars:N0} characters.", nameof(prompt));
        var userMessage = new ChatMessage(ChatRole.User, prompt);
        history.Add(userMessage);
        var chatOptions = new ChatOptions { Tools = useTools ? [.. Tools] : null };
        var updates = new List<ChatResponseUpdate>();
        var toolNames = new Dictionary<string, string>(StringComparer.Ordinal);
        var completed = false;

        try
        {
            await foreach (var update in GetClient(forceMock).GetStreamingResponseAsync(history, chatOptions, cancellationToken))
            {
                updates.Add(update);
                foreach (var content in update.Contents)
                {
                    switch (content)
                    {
                        case FunctionCallContent call: // the model asked for a tool
                            toolNames[call.CallId] = call.Name;
                            yield return new(AiTurnEventKind.ToolCall, ToJson(call.Arguments), call.Name, call.CallId);
                            break;
                        case FunctionResultContent result: // FunctionInvokingChatClient ran it and streams the result back
                            yield return new(AiTurnEventKind.ToolResult,
                                result.Exception is { } ex ? $"error: {ex.Message}" : ToJson(result.Result),
                                toolNames.GetValueOrDefault(result.CallId), result.CallId);
                            break;
                        case TextContent { Text.Length: > 0 } text:
                            yield return new(AiTurnEventKind.Text, text.Text);
                            break;
                    }
                }
            }
            history.AddMessages(updates); // keep calls, results and the answer for the next turn
            TrimHistory(history);
            completed = true;
        }
        finally
        {
            // A failed or cancelled turn leaves no orphaned user message behind to be resent next time.
            if (!completed) history.Remove(userMessage);
        }
    }
    // </snippet:Ai.StreamTurn>

    private static string ToJson(object? value)
    {
        var json = value switch
        {
            null => "null",
            JsonElement e => JsonSerializer.Serialize(e, Indented),
            _ => JsonSerializer.Serialize(value, value.GetType(), Indented),
        };
        return json.Length > MaxDisplayChars ? json[..MaxDisplayChars] + "\n…" : json;
    }

    private static readonly JsonSerializerOptions Indented = new(AIJsonUtilities.DefaultOptions) { WriteIndented = true };
}
