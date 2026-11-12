using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DotNet11Lab.Core.Catalog;
using Microsoft.Extensions.AI;

namespace DotNet11Lab.Core.Labs.Ai;

/// <summary>
/// Mock (offline, deterministic) <see cref="IChatClient"/>: a rule-based "lab assistant" that answers from
/// <see cref="LabCatalog"/>. It is not a language model. It does, however, speak the real Microsoft.Extensions.AI
/// protocol: when a prompt matches one of the tools offered in <see cref="ChatOptions.Tools"/> it replies with
/// <see cref="FunctionCallContent"/>, so <see cref="FunctionInvokingChatClient"/> genuinely invokes the tool, and on the
/// next round-trip it summarises the <see cref="FunctionResultContent"/>. It honours JSON response formats for
/// structured output and streams real chunks.
/// </summary>
public sealed partial class LabAssistantChatClient(TimeSpan? streamDelay = null) : IChatClient
{
    public const string ProviderName = "dotnet11lab-mock";
    public const string ModelId = "lab-assistant-rules-v1";

    private static readonly ChatClientMetadata Metadata = new(ProviderName, new Uri("urn:dotnet11lab:mock"), ModelId);
    private readonly TimeSpan _streamDelay = streamDelay ?? TimeSpan.FromMilliseconds(18);

    // <snippet:Ai.MockClient>
    public Task<ChatResponse> GetResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var reply = Plan([.. messages], options);
        var message = new ChatMessage(ChatRole.Assistant, reply.Contents) { MessageId = reply.Id };
        return Task.FromResult(new ChatResponse(message)
        {
            ResponseId = reply.Id,
            ModelId = ModelId,
            FinishReason = reply.Contents.OfType<FunctionCallContent>().Any() ? ChatFinishReason.ToolCalls : ChatFinishReason.Stop,
        });
    }

    public async IAsyncEnumerable<ChatResponseUpdate> GetStreamingResponseAsync(IEnumerable<ChatMessage> messages, ChatOptions? options = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var reply = Plan([.. messages], options);
        var calls = reply.Contents.OfType<FunctionCallContent>().ToList();
        if (calls.Count > 0)
        {
            // Tool calls arrive as one update; FunctionInvokingChatClient intercepts it and runs the tools.
            yield return new ChatResponseUpdate(ChatRole.Assistant, [.. calls])
            {
                ResponseId = reply.Id, MessageId = reply.Id, ModelId = ModelId, FinishReason = ChatFinishReason.ToolCalls,
            };
            yield break;
        }

        foreach (var chunk in Chunk(reply.Text))
        {
            await Task.Delay(_streamDelay, cancellationToken);
            yield return new ChatResponseUpdate(ChatRole.Assistant, chunk) { ResponseId = reply.Id, MessageId = reply.Id, ModelId = ModelId };
        }
        yield return new ChatResponseUpdate { Role = ChatRole.Assistant, ResponseId = reply.Id, MessageId = reply.Id, FinishReason = ChatFinishReason.Stop };
    }
    // </snippet:Ai.MockClient>

    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceKey is not null ? null
        : serviceType == typeof(ChatClientMetadata) ? Metadata
        : serviceType.IsInstanceOfType(this) ? this
        : null;

    public void Dispose() { }

    private sealed record Reply(string Id, IList<AIContent> Contents)
    {
        public string Text => string.Concat(Contents.OfType<TextContent>().Select(t => t.Text));
    }

    // <snippet:Ai.MockPlan>
    private static Reply Plan(IReadOnlyList<ChatMessage> messages, ChatOptions? options)
    {
        var lastUser = messages.Select((m, i) => (m, i)).LastOrDefault(x => x.m.Role == ChatRole.User);
        var prompt = lastUser.m?.Text ?? "";
        var turn = messages.Count(m => m.Role == ChatRole.User);
        var id = $"mock-{turn}-{messages.Count}";
        var sinceUser = lastUser.m is null ? messages : messages.Skip(lastUser.i + 1).ToList();

        // 1. Second round-trip: the middleware has executed our tool calls and appended their results.
        var results = sinceUser.SelectMany(m => m.Contents).OfType<FunctionResultContent>().ToList();
        if (results.Count > 0)
        {
            var calls = sinceUser.SelectMany(m => m.Contents).OfType<FunctionCallContent>().ToDictionary(c => c.CallId, c => c.Name);
            return Text(id, string.Join("\n\n", results.Select(r => SummariseResult(calls.GetValueOrDefault(r.CallId, "tool"), r))));
        }

        // 2. Structured output: GetResponseAsync<T> asked for JSON matching a schema.
        if (options?.ResponseFormat is ChatResponseFormatJson)
            return Text(id, JsonSerializer.Serialize(Summarise(prompt), JsonSerializerOptions.Web));

        // 3. Tool selection: emit FunctionCallContent for a tool the caller actually offered.
        var offered = options?.Tools?.Select(t => t.Name).ToHashSet(StringComparer.Ordinal) ?? [];
        var call = ChooseTool(prompt, offered);
        if (call is not null)
            return new(id, [new FunctionCallContent($"call_{turn}_{call.Value.Name}", call.Value.Name, call.Value.Args)]);

        // 4. Plain answer from the catalog.
        return Text(id, Answer(prompt, offered.Count > 0));
    }
    // </snippet:Ai.MockPlan>

    private static Reply Text(string id, string text) => new(id, [new TextContent(text)]);

    internal static (string Name, Dictionary<string, object?> Args)? ChooseTool(string prompt, IReadOnlySet<string> offered)
    {
        var p = prompt.ToLowerInvariant();
        (string, Dictionary<string, object?>)? Offer(string name, Dictionary<string, object?> args) => offered.Contains(name) ? (name, args) : null;

        if (p.Contains("reconcil"))
        {
            var entries = EntryList().Matches(prompt).Select(m => m.Value).ToList();
            return Offer(LabAiTools.ReconcileName, entries.Count >= 2
                ? new() { ["bank"] = entries[0], ["ledger"] = entries[1] }
                : []);
        }
        if (p.Contains("compress") || p.Contains("zstandard") || p.Contains("zstd"))
        {
            var args = new Dictionary<string, object?>();
            if (Quoted().Match(prompt) is { Success: true } q) args["text"] = q.Groups[1].Value;
            if (QualityLevel().Match(p) is { Success: true } lvl) args["quality"] = int.Parse(lvl.Groups[1].Value, CultureInfo.InvariantCulture);
            return Offer(LabAiTools.MeasureZstandardName, args);
        }
        if (p.Contains("runtime") || p.Contains("which .net") || p.Contains("what version") || p.Contains("environment"))
            return Offer(LabAiTools.GetRuntimeInfoName, []);
        if (LabNumber().Match(p) is { Success: true } lab && int.TryParse(lab.Groups[1].Value, out var n) && n >= 1 && n <= LabCatalog.Labs.Count)
            return Offer(LabAiTools.GetLabFeaturesName, new() { ["labNumber"] = n });
        if (SearchQuery().Match(prompt) is { Success: true } s)
            return Offer(LabAiTools.SearchFeaturesName, new() { ["query"] = s.Groups[1].Value.Trim(' ', '?', '.', '"') });
        return null;
    }

    private static string Answer(string prompt, bool toolsOffered)
    {
        var p = prompt.ToLowerInvariant();
        if (LabNumber().Match(p) is { Success: true } m && int.TryParse(m.Groups[1].Value, out var n) && n >= 1 && n <= LabCatalog.Labs.Count)
            return DescribeLab(LabAiTools.GetLabFeatures(n));

        var hits = LabAiTools.SearchFeatures(prompt);
        if (hits.Count > 0 && !IsSmallTalk(p))
        {
            var sb = new StringBuilder("Here is what the lab catalog says:\n");
            foreach (var f in hits.Take(3))
                sb.Append(CultureInfo.InvariantCulture, $"\n• {f.Name} (Lab {f.Lab} · {f.LabTitle}, {f.Status}{(f.NewInDotNet11 ? ", new in .NET 11" : "")}): {f.Summary}");
            return sb.ToString();
        }

        return "I am the DotNet 11 Lab assistant running as a deterministic offline mock, so I only know the lab catalog. "
            + "Ask about a lab (\"What's new in lab 6?\"), a feature (\"Tell me about union types\")"
            + (toolsOffered
                ? ", or ask me to use a tool: \"Compress 'hello hello hello' with zstandard\", \"Reconcile the sample transactions\", \"Which runtime am I on?\"."
                : ". Tools are not enabled for this conversation.");
    }

    private static bool IsSmallTalk(string p) => p.Length < 12 || p.StartsWith("hello", StringComparison.Ordinal) || p.Contains("what can you do") || p.StartsWith("help", StringComparison.Ordinal);

    private static FeatureSummary Summarise(string prompt)
    {
        var quoted = Quoted().Match(prompt);
        var f = LabAiTools.SearchFeatures(quoted.Success ? quoted.Groups[1].Value : prompt).FirstOrDefault()
            ?? LabAiTools.GetLabFeatures(1).Features[0];
        return new(f.Name, f.Lab, f.Status, f.NewInDotNet11, f.Summary, f.DocsUrl);
    }

    private static string DescribeLab(LabFeaturesResult lab)
    {
        var sb = new StringBuilder(string.Create(CultureInfo.InvariantCulture, $"Lab {lab.Lab} · {lab.Title}: {lab.Tagline}\n"));
        foreach (var f in lab.Features)
            sb.Append(CultureInfo.InvariantCulture, $"\n• {f.Name} ({f.Status}{(f.NewInDotNet11 ? ", new in .NET 11" : "")}): {f.Summary}");
        return sb.ToString();
    }

    private static string SummariseResult(string tool, FunctionResultContent result)
    {
        if (result.Exception is not null || result.Result is null)
            return $"The tool `{tool}` failed: {result.Exception?.Message ?? "it returned no result"}.";

        var json = result.Result is JsonElement e ? e : JsonSerializer.SerializeToElement(result.Result, AIJsonUtilities.DefaultOptions);
        // MCP tools return a CallToolResult envelope: unwrap its structured content (or its first text block).
        if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty("structuredContent", out var structured)) json = structured;
        else if (json.ValueKind == JsonValueKind.Object && json.TryGetProperty("content", out var blocks) && blocks.ValueKind == JsonValueKind.Array
            && blocks.GetArrayLength() > 0 && blocks[0].TryGetProperty("text", out var text) && TryParse(text.GetString(), out var inner)) json = inner;

        try
        {
            var o = AIJsonUtilities.DefaultOptions;
            return tool switch
            {
                LabAiTools.GetLabFeaturesName => "I called `get_lab_features`. " + DescribeLab(json.Deserialize<LabFeaturesResult>(o)!),
                LabAiTools.SearchFeaturesName => DescribeSearch(json.Deserialize<List<FeatureDto>>(o)!),
                LabAiTools.MeasureZstandardName => DescribeCompression(json.Deserialize<CompressionResult>(o)!),
                LabAiTools.GetRuntimeInfoName => DescribeRuntime(json.Deserialize<RuntimeInfoResult>(o)!),
                LabAiTools.ReconcileName => DescribeReconciliation(json.Deserialize<ReconciliationResult>(o)!),
                _ => $"The tool `{tool}` returned:\n{json.GetRawText()}",
            };
        }
        catch (JsonException)
        {
            return $"The tool `{tool}` returned:\n{json.GetRawText()}";
        }
    }

    private static bool TryParse(string? text, out JsonElement element)
    {
        element = default;
        if (string.IsNullOrWhiteSpace(text)) return false;
        try { element = JsonDocument.Parse(text).RootElement.Clone(); return true; }
        catch (JsonException) { return false; }
    }

    private static string DescribeSearch(List<FeatureDto> hits) => hits.Count == 0
        ? "I called `search_features`, but no catalog feature matched."
        : "I called `search_features` and found:\n" + string.Join('\n', hits.Take(5).Select(f => $"• {f.Name} (Lab {f.Lab}, {f.Status}): {f.Summary}"));

    private static string DescribeCompression(CompressionResult r) => string.Create(CultureInfo.InvariantCulture,
        $"I called `measure_zstandard` on {(r.UsedSampleText ? "the built-in sample text" : "your text")} ({r.OriginalBytes:N0} bytes). "
        + $"Zstandard (quality {r.Quality}) produced {r.ZstandardBytes:N0} bytes, a {r.ZstandardRatio:0.##}× ratio, in {r.ZstandardMicroseconds:N0} µs; "
        + $"GZip produced {r.GZipBytes:N0} bytes and Brotli {r.BrotliBytes:N0} bytes. Round-trip verified: {(r.RoundTripVerified ? "yes" : "NO")}.");

    private static string DescribeRuntime(RuntimeInfoResult r) =>
        $"I called `get_runtime_info`: this lab runs on {r.Framework} ({r.ProcessArchitecture}) on {r.OperatingSystem}, "
        + $"{r.ProcessorCount} logical processors, {(r.ServerGc ? "Server" : "Workstation")} GC in {r.GcLatencyMode} mode, "
        + $"JIT {(r.DynamicCodeCompiled ? "enabled" : "disabled (Native AOT)")}.";

    private static string DescribeReconciliation(ReconciliationResult r)
    {
        var sb = new StringBuilder(string.Create(CultureInfo.InvariantCulture,
            $"I called `reconcile_transactions` on {(r.UsedSampleData ? "the sample data" : "your entries")}: {r.Matched} matched, {r.AmountMismatches} amount mismatch(es), {r.OnlyInBank} only in the bank, {r.OnlyInLedger} only in the ledger."));
        foreach (var l in r.Lines.Where(l => l.Outcome != "matched"))
            sb.Append(CultureInfo.InvariantCulture, $"\n• {l.Id}: bank {l.Bank?.ToString("0.00", CultureInfo.InvariantCulture) ?? "—"}, ledger {l.Ledger?.ToString("0.00", CultureInfo.InvariantCulture) ?? "—"} → {l.Outcome}");
        return sb.ToString();
    }

    /// <summary>Splits text into word-sized chunks (whitespace kept), which is roughly how token streaming arrives.</summary>
    internal static IEnumerable<string> Chunk(string text)
    {
        var start = 0;
        for (var i = 1; i <= text.Length; i++)
        {
            if (i == text.Length || (char.IsWhiteSpace(text[i - 1]) && !char.IsWhiteSpace(text[i])))
            {
                yield return text[start..i];
                start = i;
            }
        }
    }

    [GeneratedRegex(@"\blab\s*#?\s*(\d{1,2})\b")]
    private static partial Regex LabNumber();

    [GeneratedRegex("(?:^|\\s)[\"'“‘](.+?)[\"'”’](?=$|\\s|[.,;:?!])")]
    private static partial Regex Quoted();

    [GeneratedRegex(@"(?:quality|level)\s*(\d{1,2})")]
    private static partial Regex QualityLevel();

    [GeneratedRegex(@"(?:[A-Za-z0-9\-]+\s*=\s*[0-9.]+\s*;\s*)+[A-Za-z0-9\-]+\s*=\s*[0-9.]+")]
    private static partial Regex EntryList();

    [GeneratedRegex(@"(?i)\b(?:search|find|look up)\b(?:\s+(?:for|the catalog for))?\s+(.+)$")]
    private static partial Regex SearchQuery();
}
