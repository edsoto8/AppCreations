using BoardFlow.App.ViewModels.Dialogs;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels;

/// <summary>Shows one modal dialog at a time over the whole window and awaits its result.</summary>
public sealed partial class DialogHost : ObservableObject
{
    [ObservableProperty]
    public partial DialogViewModel? Current { get; private set; }

    public async Task<TResult?> ShowAsync<TResult>(DialogViewModel<TResult> dialog)
    {
        Current?.Cancel();
        Current = dialog;
        try
        {
            return await dialog.Result;
        }
        finally
        {
            if (ReferenceEquals(Current, dialog))
            {
                Current = null;
            }
        }
    }

    public Task<bool> ConfirmAsync(string title, string message, string confirmText = "OK", bool isDestructive = false) =>
        ShowAsync(new ConfirmDialogViewModel(title, message, confirmText, isDestructive));

    public Task<string?> PromptAsync(string title, string label, string initialText, string confirmText, Func<string, string> validate) =>
        ShowAsync(new TextPromptDialogViewModel(title, label, initialText, confirmText, validate));
}
