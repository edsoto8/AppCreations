namespace TaskFlow.Services;

/// <summary>Shows confirmations as a WinUI <see cref="ContentDialog"/>.</summary>
public sealed class ContentDialogService(Func<XamlRoot?> xamlRoot, ThemeService theme) : IDialogService
{
    public async Task<bool> ConfirmAsync(string title, string message, string confirmText)
    {
        var dialog = new ContentDialog
        {
            Title = title,
            Content = message,
            PrimaryButtonText = confirmText,
            CloseButtonText = "Cancel",
            // Enter should not delete by accident, so Cancel is the default button.
            DefaultButton = ContentDialogButton.Close,
            // A ContentDialog must know which window (XamlRoot) to appear in.
            XamlRoot = xamlRoot(),
            // Dialogs live in a popup layer outside the page, so give them the app's chosen theme explicitly.
            RequestedTheme = theme.ElementTheme,
            Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
        };

        return await dialog.ShowAsync() == ContentDialogResult.Primary;
    }
}
