using System.ClientModel;
using Microsoft.Extensions.AI;
using OpenAI;

namespace DotNet11Lab.Core.Labs.Ai;

/// <summary>Raised when the configured real provider cannot be used. Messages never contain the API key.</summary>
public sealed class AiProviderUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>
/// Turns <see cref="AiOptions"/> into the innermost <see cref="IChatClient"/>. Misconfiguration does not throw at
/// startup: the dashboard must still run, so an <see cref="UnavailableChatClient"/> explains the problem instead.
/// </summary>
public static class AiProviderFactory
{
    public const string DefaultOpenAIModel = "gpt-4o-mini";

    /// <summary>
    /// The OpenAI SDK requires a non-empty credential even for endpoints that ignore it (a local Ollama). This marker is
    /// sent only to such keyless OpenAI-compatible endpoints; it is not a secret.
    /// </summary>
    private const string KeylessEndpointMarker = "no-key-configured";

    public static AiProviderStatus Describe(AiOptions options)
    {
        var hasKey = !string.IsNullOrWhiteSpace(options.ApiKey);
        var endpoint = TryEndpoint(options.Endpoint, out var uri) ? uri : null;
        var host = endpoint is null ? null : $"{endpoint.Scheme}://{endpoint.Authority}";
        return options.Provider switch
        {
            AiProviderKind.Mock => new(AiProviderKind.Mock, "Mock (offline, deterministic)", LabAssistantChatClient.ModelId, null, hasKey, null),
            AiProviderKind.OpenAI => new(AiProviderKind.OpenAI, "OpenAI", Blank(options.Model) ?? DefaultOpenAIModel, host ?? "https://api.openai.com", hasKey,
                hasKey ? null : "OpenAI needs an API key. Set Ai:ApiKey with 'dotnet user-secrets' or the Ai__ApiKey environment variable."),
            AiProviderKind.AzureOpenAI => new(AiProviderKind.AzureOpenAI, "Azure OpenAI", Blank(options.Model), host, hasKey,
                endpoint is null ? "Azure OpenAI needs Ai:Endpoint, e.g. https://<resource>.openai.azure.com/openai/v1/."
                : Blank(options.Model) is null ? "Azure OpenAI needs Ai:Model (the deployment name)."
                : hasKey ? null : "Azure OpenAI needs an API key (Ai:ApiKey via user secrets or Ai__ApiKey)."),
            AiProviderKind.OpenAICompatible => new(AiProviderKind.OpenAICompatible, "OpenAI-compatible", Blank(options.Model), host, hasKey,
                endpoint is null ? "OpenAI-compatible providers need Ai:Endpoint, e.g. http://localhost:11434/v1 for Ollama."
                : Blank(options.Model) is null ? "OpenAI-compatible providers need Ai:Model, e.g. llama3.2." : null),
            _ => new(options.Provider, options.Provider.ToString(), null, null, hasKey, $"Unknown provider '{options.Provider}'."),
        };
    }

    // <snippet:Ai.ProviderFactory>
    public static IChatClient CreateInnerClient(AiOptions options)
    {
        var status = Describe(options);
        if (status.Problem is not null) return new UnavailableChatClient(status);
        if (status.Kind == AiProviderKind.Mock) return new LabAssistantChatClient();

        // OpenAI, Azure OpenAI (v1 API) and Ollama/LM Studio/vLLM all speak the same wire protocol, so one SDK covers
        // them; only the endpoint and credential differ. AsIChatClient() adapts the SDK to Microsoft.Extensions.AI.
        var clientOptions = new OpenAIClientOptions();
        if (TryEndpoint(options.Endpoint, out var endpoint)) clientOptions.Endpoint = endpoint;
        var credential = new ApiKeyCredential(string.IsNullOrWhiteSpace(options.ApiKey) ? KeylessEndpointMarker : options.ApiKey);

        return new OpenAIClient(credential, clientOptions)
            .GetChatClient(status.Model)
            .AsIChatClient();
    }
    // </snippet:Ai.ProviderFactory>

    /// <summary>
    /// Converts provider failures into a message that is safe to display: no stack traces, no request bodies and,
    /// defensively, any occurrence of the API key replaced.
    /// </summary>
    public static string DescribeFailure(Exception ex, AiOptions options)
    {
        var status = Describe(options);
        var message = ex switch
        {
            AiProviderUnavailableException u => u.Message,
            ClientResultException { Status: 401 or 403 } c => $"{status.DisplayName} rejected the credentials (HTTP {c.Status}). Check Ai:ApiKey.",
            ClientResultException { Status: 404 } => $"{status.DisplayName} returned 404: the model or deployment '{status.Model}' was not found at {status.EndpointHost}.",
            ClientResultException { Status: 429 } => $"{status.DisplayName} is rate limiting requests (HTTP 429).",
            ClientResultException c => $"{status.DisplayName} returned HTTP {c.Status}: {FirstLine(c.Message)}",
            HttpRequestException h => $"Could not reach {status.EndpointHost ?? status.DisplayName}: {h.HttpRequestError} ({FirstLine(h.Message)}).",
            TaskCanceledException or TimeoutException => $"{status.DisplayName} did not answer in time.",
            _ => $"{status.DisplayName} failed: {ex.GetType().Name}: {FirstLine(ex.Message)}",
        };
        return string.IsNullOrEmpty(options.ApiKey) ? message : message.Replace(options.ApiKey, "***", StringComparison.Ordinal);
    }

    private static string FirstLine(string s)
    {
        var line = s.Split('\n', 2)[0].Trim();
        return line.Length > 240 ? line[..240] + "…" : line;
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static bool TryEndpoint(string? value, out Uri uri)
    {
        uri = null!;
        return !string.IsNullOrWhiteSpace(value)
            && Uri.TryCreate(value.Trim(), UriKind.Absolute, out uri!)
            && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
    }
}

/// <summary>Stands in for a misconfigured provider so the rest of the pipeline (and the page) still works.</summary>
public sealed class UnavailableChatClient(AiProviderStatus status) : IChatClient
{
    private readonly ChatClientMetadata _metadata = new(status.DisplayName, null, status.Model);

    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new AiProviderUnavailableException(status.Problem ?? "The provider is unavailable.");

    public IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default) =>
        throw new AiProviderUnavailableException(status.Problem ?? "The provider is unavailable.");

    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is null && serviceType == typeof(ChatClientMetadata) ? _metadata
        : serviceKey is null && serviceType.IsInstanceOfType(this) ? this : null;

    public void Dispose() { }
}
