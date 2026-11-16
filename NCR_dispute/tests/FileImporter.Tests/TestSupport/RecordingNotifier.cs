using FileImporter.Core.Abstractions;
using FileImporter.Core.Models;

namespace FileImporter.Tests.TestSupport;

public sealed class RecordingNotifier : INotificationService
{
    public List<ImportAlert> Alerts { get; } = [];

    public Exception? ThrowOnSend { get; set; }

    public Task SendFailureAlertAsync(ImportAlert alert, CancellationToken cancellationToken)
    {
        if (ThrowOnSend is not null)
        {
            throw ThrowOnSend;
        }

        Alerts.Add(alert);
        return Task.CompletedTask;
    }
}
