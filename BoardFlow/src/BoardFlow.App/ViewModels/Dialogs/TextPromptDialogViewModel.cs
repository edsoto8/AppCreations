using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels.Dialogs;

/// <summary>Asks for one line of text. <c>validate</c> normalises the text or throws a ValidationException.</summary>
public sealed partial class TextPromptDialogViewModel(
    string title, string label, string initialText, string confirmText, Func<string, string> validate)
    : DialogViewModel<string>(title)
{
    public string Label { get; } = label;

    public override string ConfirmText { get; } = confirmText;

    [ObservableProperty]
    public partial string Text { get; set; } = initialText;

    protected override string BuildResult() => validate(Text);
}
