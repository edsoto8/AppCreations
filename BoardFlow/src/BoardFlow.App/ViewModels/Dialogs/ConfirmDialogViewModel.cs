namespace BoardFlow.App.ViewModels.Dialogs;

public sealed class ConfirmDialogViewModel(string title, string message, string confirmText, bool isDestructive)
    : DialogViewModel<bool>(title)
{
    public string Message { get; } = message;

    public override string ConfirmText { get; } = confirmText;

    public override bool IsDestructive { get; } = isDestructive;

    protected override bool BuildResult() => true;
}
