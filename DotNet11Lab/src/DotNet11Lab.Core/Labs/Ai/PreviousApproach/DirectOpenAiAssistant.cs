using System.Text.Json;
using OpenAI.Chat;

namespace DotNet11Lab.Core.Labs.Ai.PreviousApproach;

/// <summary>
/// PREVIOUS APPROACH (compiled, never executed by the lab: it needs a live OpenAI endpoint). Calling a provider SDK
/// directly ties the app to that vendor's message types and forces you to hand-write the tool loop, tracing and logging
/// that Microsoft.Extensions.AI middleware supplies. Shown for comparison with <see cref="LabAssistant"/>.
/// </summary>
public sealed class DirectOpenAiAssistant(ChatClient openAiChatClient)
{
    // <snippet:Ai.PreviousDirectSdk>
    private static readonly ChatTool LabFeaturesTool = ChatTool.CreateFunctionTool(
        functionName: "get_lab_features",
        functionDescription: "Lists the .NET 11 features demonstrated by one lab.",
        functionParameters: BinaryData.FromString("""
            { "type": "object", "properties": { "labNumber": { "type": "integer" } }, "required": ["labNumber"] }
            """));

    public async Task<string> AskAsync(string question, CancellationToken cancellationToken)
    {
        List<ChatMessage> messages = [new SystemChatMessage(LabAssistant.SystemPrompt), new UserChatMessage(question)];
        var options = new ChatCompletionOptions { Tools = { LabFeaturesTool } };

        for (var iteration = 0; iteration < 4; iteration++) // hand-written tool loop
        {
            ChatCompletion completion = await openAiChatClient.CompleteChatAsync(messages, options, cancellationToken);
            if (completion.FinishReason != ChatFinishReason.ToolCalls)
                return completion.Content.Count > 0 ? completion.Content[0].Text : "";

            messages.Add(new AssistantChatMessage(completion));
            foreach (var call in completion.ToolCalls)
            {
                // Manual argument parsing, dispatch and serialization for every tool.
                using var args = JsonDocument.Parse(call.FunctionArguments);
                var result = call.FunctionName == "get_lab_features"
                    ? JsonSerializer.Serialize(LabAiTools.GetLabFeatures(args.RootElement.GetProperty("labNumber").GetInt32()))
                    : $"Unknown tool {call.FunctionName}";
                messages.Add(new ToolChatMessage(call.Id, result));
            }
        }
        throw new InvalidOperationException("Tool loop did not converge.");
    }
    // </snippet:Ai.PreviousDirectSdk>
}
