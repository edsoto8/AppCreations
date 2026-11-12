namespace TaskFlow.Core.Services;

/// <summary>Asks the user a question. The app shows a ContentDialog; tests answer automatically.</summary>
public interface IDialogService
{
    /// <summary>Returns true when the user chose <paramref name="confirmText"/>, false when they cancelled.</summary>
    Task<bool> ConfirmAsync(string title, string message, string confirmText);
}
