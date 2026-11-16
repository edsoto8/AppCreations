namespace FileImporter.Core.Configuration;

/// <summary>Failure e-mail settings. Section "Smtp". Keep the password in an environment variable or user secrets.</summary>
public sealed class SmtpOptions
{
    public const string SectionName = "Smtp";

    /// <summary>Set to false to log alerts instead of sending them (useful on a developer machine).</summary>
    public bool Enabled { get; set; } = true;

    public string Host { get; set; } = string.Empty;

    public int Port { get; set; } = 587;

    /// <summary>MailKit SecureSocketOptions: None, Auto, SslOnConnect, StartTls or StartTlsWhenAvailable.</summary>
    public string Security { get; set; } = "StartTls";

    /// <summary>Leave empty for an SMTP relay that does not need authentication.</summary>
    public string? Username { get; set; }

    /// <summary>Set through the environment variable Smtp__Password or user secrets.</summary>
    public string? Password { get; set; }

    public string From { get; set; } = string.Empty;

    public List<string> To { get; set; } = [];

    public string SubjectPrefix { get; set; } = "[NCR Dispute Import]";

    public int TimeoutSeconds { get; set; } = 30;
}
