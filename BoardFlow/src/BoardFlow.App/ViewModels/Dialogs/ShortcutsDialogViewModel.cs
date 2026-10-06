namespace BoardFlow.App.ViewModels.Dialogs;

public sealed record Shortcut(string Keys, string Action);

/// <summary>Lists the keyboard shortcuts (F1 or the board menu).</summary>
public sealed class ShortcutsDialogViewModel() : DialogViewModel<bool>("Keyboard shortcuts")
{
    public IReadOnlyList<Shortcut> Shortcuts { get; } =
    [
        new("Ctrl+N", "Quick-add a card to the first column"),
        new("Ctrl+F", "Search cards"),
        new("Enter", "Open the focused card · confirm a dialog"),
        new("Escape", "Close the dialog or panel · clear search"),
        new("Ctrl+Enter", "Save the open card"),
        new("Ctrl+↑ / Ctrl+↓", "Move the focused card up / down"),
        new("Ctrl+← / Ctrl+→", "Move the focused card to the previous / next column"),
        new("Tab / Shift+Tab", "Move between cards and controls"),
        new("F1", "Show this list"),
    ];

    public override string ConfirmText => "Close";

    public override bool ShowCancel => false;

    protected override bool BuildResult() => true;
}
