using System.Reflection;
using Microsoft.Extensions.AI;

namespace DotNet11Lab.Core.Labs.Ai;

/// <summary>One link of a built <see cref="IChatClient"/> chain, outermost first.</summary>
public sealed record PipelineStage(string TypeName, string Detail);

public static class AiPipeline
{
    /// <summary>
    /// Same name as the Web host's LabTelemetry source, which its OpenTelemetry tracer and meter already listen to, so
    /// the gen_ai.* spans and metrics emitted by <see cref="OpenTelemetryChatClient"/> are exported with no extra wiring.
    /// </summary>
    public const string TelemetrySourceName = "DotNet11Lab";

    public const int MaxToolIterations = 4;

    // <snippet:Ai.Middleware>
    /// <summary>
    /// Middleware applied to every provider. The first Use* call is the outermost wrapper:
    /// Logging → FunctionInvocation → OpenTelemetry → provider, so each model round-trip of a tool loop gets its own span.
    /// </summary>
    public static ChatClientBuilder UseLabMiddleware(this ChatClientBuilder builder) => builder
        .UseLogging()
        .UseFunctionInvocation(configure: f =>
        {
            f.MaximumIterationsPerRequest = MaxToolIterations; // bound the tool loop
            f.IncludeDetailedErrors = false;                   // do not echo exception details back to the model
        })
        .UseOpenTelemetry(sourceName: TelemetrySourceName, configure: o => o.EnableSensitiveData = false);
    // </snippet:Ai.Middleware>

    private static readonly PropertyInfo InnerClientProperty =
        typeof(DelegatingChatClient).GetProperty("InnerClient", BindingFlags.Instance | BindingFlags.NonPublic)
        ?? throw new MissingMemberException(nameof(DelegatingChatClient), "InnerClient");

    /// <summary>
    /// Walks the real chain that DI built. <see cref="DelegatingChatClient.InnerClient"/> is protected, so this diagnostic
    /// view reads it by reflection; application code would normally use <c>GetService&lt;T&gt;()</c> instead.
    /// </summary>
    public static IReadOnlyList<PipelineStage> Describe(IChatClient client)
    {
        var stages = new List<PipelineStage>();
        for (var current = client; current is not null && stages.Count < 16;)
        {
            stages.Add(new(current.GetType().Name, Detail(current)));
            current = current is DelegatingChatClient d ? InnerClientProperty.GetValue(d) as IChatClient : null;
        }
        return stages;
    }

    private static string Detail(IChatClient client) => client switch
    {
        LoggingChatClient => "ILogger: invocations at Debug, content only at Trace",
        FunctionInvokingChatClient f => $"runs tool calls; max {f.MaximumIterationsPerRequest} iterations, detailed errors {(f.IncludeDetailedErrors ? "on" : "off")}",
        OpenTelemetryChatClient => $"gen_ai spans + metrics on '{TelemetrySourceName}', sensitive data off",
        DelegatingChatClient => "middleware",
        _ when client.GetService<ChatClientMetadata>() is { } m => $"provider '{m.ProviderName}', model '{m.DefaultModelId ?? "(per request)"}'",
        _ => "provider",
    };
}
