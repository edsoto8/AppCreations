using FileImporter.Core.Models;

namespace FileImporter.Core.Abstractions;

/// <summary>Sends failure alerts (e-mail in this app).</summary>
public interface INotificationService
{
    Task SendFailureAlertAsync(ImportAlert alert, CancellationToken cancellationToken);
}
