using BoardFlow.Core.Rules;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels.Dialogs;

public sealed record BoardDialogResult(string Name, string Description, bool AddDefaultColumns);

/// <summary>Create or edit a board's name and description.</summary>
public sealed partial class BoardDialogViewModel : DialogViewModel<BoardDialogResult>
{
    public BoardDialogViewModel(string? name = null, string? description = null)
        : base(name is null ? "New board" : "Edit board")
    {
        IsNew = name is null;
        Name = name ?? "";
        Description = description ?? "";
        AddDefaultColumns = IsNew;
    }

    public bool IsNew { get; }

    public override string ConfirmText => IsNew ? "Create board" : "Save";

    public string DefaultColumnsText { get; } = "Add default columns (" + string.Join(", ", DefaultColumns.Names) + ")";

    [ObservableProperty]
    public partial string Name { get; set; }

    [ObservableProperty]
    public partial string Description { get; set; }

    [ObservableProperty]
    public partial bool AddDefaultColumns { get; set; }

    protected override BoardDialogResult BuildResult() =>
        new(Validate.Name(Name, "Board name"), Validate.Description(Description), IsNew && AddDefaultColumns);
}
