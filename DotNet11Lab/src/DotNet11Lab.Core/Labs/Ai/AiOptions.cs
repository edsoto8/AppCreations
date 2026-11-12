namespace DotNet11Lab.Core.Labs.Ai;

/// <summary>Which <see cref="Microsoft.Extensions.AI.IChatClient"/> implementation sits at the end of the pipeline.</summary>
public enum AiProviderKind
{
    /// <summary>The deterministic, offline <see cref="LabAssistantChatClient"/>. The default.</summary>
    Mock,
    /// <summary>api.openai.com through the official OpenAI SDK.</summary>
    OpenAI,
    /// <summary>An Azure OpenAI resource through its OpenAI-compatible <c>/openai/v1/</c> endpoint.</summary>
    AzureOpenAI,
    /// <summary>Any OpenAI-compatible endpoint, e.g. Ollama at <c>http://localhost:11434/v1</c>.</summary>
    OpenAICompatible,
}

/// <summary>
/// The <c>Ai</c> configuration section. <see cref="ApiKey"/> is read from configuration only (user secrets or the
/// <c>Ai__ApiKey</c> environment variable); it is never written to appsettings.json, logged or displayed.
/// </summary>
public sealed class AiOptions
{
    public const string SectionName = "Ai";

    public AiProviderKind Provider { get; set; } = AiProviderKind.Mock;

    /// <summary>Model id (OpenAI / compatible) or deployment name (Azure OpenAI).</summary>
    public string? Model { get; set; }

    /// <summary>Base URL of the OpenAI-compatible API. Ignored for <see cref="AiProviderKind.OpenAI"/> unless set.</summary>
    public string? Endpoint { get; set; }

    public string? ApiKey { get; set; }

    /// <summary>Optional explicit path of the built DotNet11Lab.Mcp server (executable or .dll) for the MCP probe.</summary>
    public string? McpServerPath { get; set; }
}

/// <summary>
/// What the UI may know about the configured provider. Deliberately contains <see cref="HasApiKey"/> (a boolean)
/// and never the key itself.
/// </summary>
public sealed record AiProviderStatus(
    AiProviderKind Kind,
    string DisplayName,
    string? Model,
    string? EndpointHost,
    bool HasApiKey,
    string? Problem)
{
    public bool IsMock => Kind == AiProviderKind.Mock;
    public bool IsUsable => Problem is null;
}
