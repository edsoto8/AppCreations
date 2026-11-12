using System.ComponentModel;
using Microsoft.Extensions.AI;

namespace DotNet11Lab.Core.Labs.Ai;

// <snippet:Ai.StructuredOutput>
/// <summary>A typed answer extracted with <c>GetResponseAsync&lt;FeatureSummary&gt;</c>.</summary>
[Description("A short structured summary of one .NET 11 feature.")]
public sealed record FeatureSummary(
    [property: Description("Feature name as listed in the lab catalog.")] string Feature,
    [property: Description("Lab number (1-9) that demonstrates it.")] int LabNumber,
    [property: Description("Stable, OptIn, Experimental or Baseline.")] string Status,
    [property: Description("True when the feature first ships in .NET 11.")] bool NewInDotNet11,
    [property: Description("One sentence describing the feature.")] string Summary,
    [property: Description("Official documentation URL.")] string DocsUrl);

public static class FeatureSummaryExtractor
{
    /// <summary>
    /// Microsoft.Extensions.AI derives a JSON schema from <see cref="FeatureSummary"/>, sends it as the response format
    /// and deserializes the reply. Works with any provider that honours JSON output, including the offline mock.
    /// </summary>
    public static async Task<ChatResponse<FeatureSummary>> ExtractAsync(IChatClient client, string feature, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(feature);
        feature = feature.Trim()[..Math.Min(feature.Trim().Length, 200)];
        return await client.GetResponseAsync<FeatureSummary>(
            $"Summarise the .NET 11 feature \"{feature}\" from the DotNet 11 Lab catalog.",
            cancellationToken: cancellationToken);
    }
}
// </snippet:Ai.StructuredOutput>
