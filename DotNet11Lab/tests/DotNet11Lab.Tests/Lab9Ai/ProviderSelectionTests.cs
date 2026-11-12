using System.ClientModel.Primitives;
using DotNet11Lab.Core.Labs.Ai;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Tests.Lab9Ai;

public class ProviderSelectionTests
{
    private static readonly CancellationToken Ct = TestContext.Current.CancellationToken;
    private const string FakeKey = "sk-test-DO-NOT-LEAK-0123456789";

    [Fact]
    public void Mock_is_the_default_provider()
    {
        using var services = PipelineTests.BuildServices();
        var assistant = services.GetRequiredService<LabAssistant>();

        Assert.Equal(AiProviderKind.Mock, assistant.Status.Kind);
        Assert.Equal("Mock (offline, deterministic)", assistant.Status.DisplayName);
        Assert.True(assistant.Status.IsUsable);
        Assert.Equal(LabAssistantChatClient.ProviderName, services.GetRequiredService<IChatClient>().GetService<ChatClientMetadata>()?.ProviderName);
    }

    [Fact]
    public async Task OpenAI_without_a_key_reports_a_clear_problem_and_the_mock_still_works()
    {
        using var services = PipelineTests.BuildServices(new() { ["Ai:Provider"] = "OpenAI" });
        var assistant = services.GetRequiredService<LabAssistant>();

        Assert.False(assistant.Status.HasApiKey);
        Assert.Contains("API key", assistant.Status.Problem, StringComparison.Ordinal);
        Assert.Equal(AiProviderFactory.DefaultOpenAIModel, assistant.Status.Model);

        var ex = await Assert.ThrowsAsync<AiProviderUnavailableException>(() => assistant.AskAsync("hi", forceMock: false, Ct));
        Assert.Contains("Ai__ApiKey", assistant.DescribeFailure(ex), StringComparison.Ordinal);

        Assert.NotEmpty(await assistant.AskAsync("What's new in lab 2?", forceMock: true, Ct));
        Assert.Equal(nameof(LabAssistantChatClient), assistant.DescribePipeline(forceMock: true)[^1].TypeName);
    }

    [Fact]
    public void A_configured_key_is_reported_as_a_boolean_only()
    {
        using var services = PipelineTests.BuildServices(new() { ["Ai:Provider"] = "OpenAI", ["Ai:ApiKey"] = FakeKey, ["Ai:Model"] = "gpt-4.1-mini" });
        var assistant = services.GetRequiredService<LabAssistant>();

        Assert.True(assistant.Status.IsUsable);
        Assert.True(assistant.Status.HasApiKey);
        Assert.DoesNotContain(FakeKey, assistant.Status.ToString(), StringComparison.Ordinal);

        // The real OpenAI adapter is built (no network call happens until a request is made).
        var leaf = assistant.DescribePipeline(forceMock: false)[^1];
        Assert.Contains("gpt-4.1-mini", leaf.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain(FakeKey, string.Join(" ", assistant.DescribePipeline(false)), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("AzureOpenAI", null, "gpt", "Ai:Endpoint")]
    [InlineData("AzureOpenAI", "https://example.openai.azure.com/openai/v1/", null, "deployment")]
    [InlineData("OpenAICompatible", null, "llama3.2", "Ai:Endpoint")]
    [InlineData("OpenAICompatible", "http://localhost:11434/v1", null, "Ai:Model")]
    public void Incomplete_configuration_is_explained(string provider, string? endpoint, string? model, string expected)
    {
        var status = AiProviderFactory.Describe(new AiOptions { Provider = Enum.Parse<AiProviderKind>(provider), Endpoint = endpoint, Model = model });
        Assert.Contains(expected, status.Problem, StringComparison.Ordinal);
    }

    [Fact]
    public void Ollama_style_endpoint_needs_no_key()
    {
        var options = new AiOptions { Provider = AiProviderKind.OpenAICompatible, Endpoint = "http://localhost:11434/v1", Model = "llama3.2" };
        var status = AiProviderFactory.Describe(options);

        Assert.True(status.IsUsable);
        Assert.Equal("http://localhost:11434", status.EndpointHost);
        Assert.IsNotType<UnavailableChatClient>(AiProviderFactory.CreateInnerClient(options));
    }

    [Fact]
    public void Failure_messages_never_contain_the_key()
    {
        var options = new AiOptions { Provider = AiProviderKind.OpenAI, ApiKey = FakeKey };

        var leaky = new InvalidOperationException($"Request failed with header Authorization: Bearer {FakeKey}");
        var described = AiProviderFactory.DescribeFailure(leaky, options);
        Assert.DoesNotContain(FakeKey, described, StringComparison.Ordinal);
        Assert.Contains("***", described, StringComparison.Ordinal);

        var http = new HttpRequestException(HttpRequestError.ConnectionError, "Connection refused");
        Assert.Contains("Could not reach https://api.openai.com", AiProviderFactory.DescribeFailure(http, options), StringComparison.Ordinal);
    }

    [Fact]
    public void Unauthorized_responses_are_described_without_details()
    {
        var response = new FakeResponse(401);
        var described = AiProviderFactory.DescribeFailure(new System.ClientModel.ClientResultException(response), new AiOptions { Provider = AiProviderKind.OpenAI, ApiKey = FakeKey });
        Assert.Equal("OpenAI rejected the credentials (HTTP 401). Check Ai:ApiKey.", described);
    }

    private sealed class FakeResponse(int status) : PipelineResponse
    {
        public override int Status => status;
        public override string ReasonPhrase => "Unauthorized";
        public override Stream? ContentStream { get; set; }
        public override BinaryData Content => BinaryData.FromString("");
        protected override PipelineResponseHeaders HeadersCore => throw new NotSupportedException();
        public override BinaryData BufferContent(CancellationToken cancellationToken = default) => Content;
        public override ValueTask<BinaryData> BufferContentAsync(CancellationToken cancellationToken = default) => ValueTask.FromResult(Content);
        public override void Dispose() { }
    }
}
