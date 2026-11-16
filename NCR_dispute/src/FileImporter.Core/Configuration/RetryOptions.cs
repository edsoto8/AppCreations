namespace FileImporter.Core.Configuration;

/// <summary>Simple retry settings for transient SQL, file and SMTP errors. Section "Retry".</summary>
public sealed class RetryOptions
{
    public const string SectionName = "Retry";

    /// <summary>Total attempts including the first one. 1 disables retries.</summary>
    public int MaxAttempts { get; set; } = 3;

    /// <summary>Delay before the second attempt; doubled for every attempt after that.</summary>
    public int InitialDelaySeconds { get; set; } = 2;
}
