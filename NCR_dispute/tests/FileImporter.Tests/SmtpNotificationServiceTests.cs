using FileImporter.Core.Configuration;
using FileImporter.Core.Infrastructure;
using FileImporter.Core.Models;

namespace FileImporter.Tests;

public sealed class SmtpNotificationServiceTests
{
    private static readonly SmtpOptions Smtp = new()
    {
        From = "importer@example.com",
        To = ["ops@example.com", "data@example.com"],
        SubjectPrefix = "[NCR]",
    };

    [Fact]
    public void BuildMessage_IncludesFileImportIdTimestampAndError()
    {
        var importId = Guid.NewGuid();
        var alert = new ImportAlert("disputes.csv", importId, "Database validation", "Row 2: bad amount",
            new DateTimeOffset(2026, 11, 16, 8, 30, 0, TimeSpan.Zero));

        using var message = SmtpNotificationService.BuildMessage(alert, Smtp);

        Assert.Equal("[NCR] Database validation failed: disputes.csv", message.Subject);
        Assert.Equal(["ops@example.com", "data@example.com"], message.To.Mailboxes.Select(m => m.Address));
        var body = message.TextBody;
        Assert.Contains("disputes.csv", body);
        Assert.Contains(importId.ToString(), body);
        Assert.Contains("2026-11-16 08:30:00", body);
        Assert.Contains("Row 2: bad amount", body);
    }

    [Fact]
    public void BuildMessage_WithoutImportId_SaysSo()
    {
        var alert = new ImportAlert("disputes.csv", null, "Reading file", "Access denied", DateTimeOffset.Now);

        using var message = SmtpNotificationService.BuildMessage(alert, Smtp);

        Assert.Contains("(none - failed before a tracking record was created)", message.TextBody);
    }
}
