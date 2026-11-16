using System.Text;
using FileImporter.Core.Abstractions;
using FileImporter.Core.Configuration;
using FileImporter.Core.Models;
using MailKit;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using MimeKit;

namespace FileImporter.Core.Infrastructure;

/// <summary>Sends failure alerts by e-mail with MailKit. When SMTP is disabled the alert is only logged.</summary>
public sealed class SmtpNotificationService(
    IOptions<SmtpOptions> options,
    RetryPolicy retryPolicy,
    ILogger<SmtpNotificationService> logger) : INotificationService
{
    public async Task SendFailureAlertAsync(ImportAlert alert, CancellationToken cancellationToken)
    {
        var smtp = options.Value;
        if (!smtp.Enabled)
        {
            logger.LogWarning("SMTP is disabled; alert not e-mailed: {Stage} failed for {FileName} (ImportId {ImportId}): {Error}",
                alert.Stage, alert.FileName, alert.ImportId, alert.ErrorSummary);
            return;
        }

        using var message = BuildMessage(alert, smtp);
        await retryPolicy.ExecuteAsync("send alert e-mail", async ct =>
        {
            using var client = new SmtpClient { Timeout = (int)TimeSpan.FromSeconds(smtp.TimeoutSeconds).TotalMilliseconds };
            await client.ConnectAsync(smtp.Host, smtp.Port, Enum.Parse<SecureSocketOptions>(smtp.Security, ignoreCase: true), ct).ConfigureAwait(false);
            if (!string.IsNullOrWhiteSpace(smtp.Username))
            {
                await client.AuthenticateAsync(smtp.Username, smtp.Password ?? string.Empty, ct).ConfigureAwait(false);
            }

            await client.SendAsync(new SendRequest(message), ct).ConfigureAwait(false);
            await client.DisconnectAsync(quit: true, ct).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);

        logger.LogInformation("Alert e-mail sent to {RecipientCount} recipient(s) for {FileName}", smtp.To.Count, alert.FileName);
    }

    internal static MimeMessage BuildMessage(ImportAlert alert, SmtpOptions smtp)
    {
        var message = new MimeMessage();
        message.From.Add(MailboxAddress.Parse(smtp.From));
        foreach (var recipient in smtp.To)
        {
            message.To.Add(MailboxAddress.Parse(recipient));
        }

        message.Subject = $"{smtp.SubjectPrefix} {alert.Stage} failed: {alert.FileName}".Trim();

        var body = new StringBuilder()
            .AppendLine("A file import did not complete.")
            .AppendLine()
            .AppendLine($"File:       {alert.FileName}")
            .AppendLine($"Import ID:  {(alert.ImportId?.ToString() ?? "(none - failed before a tracking record was created)")}")
            .AppendLine($"Stage:      {alert.Stage}")
            .AppendLine($"Timestamp:  {alert.Timestamp:yyyy-MM-dd HH:mm:ss zzz}")
            .AppendLine($"Machine:    {Environment.MachineName}")
            .AppendLine()
            .AppendLine("Error summary:")
            .AppendLine(alert.ErrorSummary);

        message.Body = new TextPart("plain") { Text = body.ToString() };
        return message;
    }
}
