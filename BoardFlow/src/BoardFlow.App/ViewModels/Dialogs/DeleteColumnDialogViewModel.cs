using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Data.Repositories;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels.Dialogs;

public sealed record DeleteColumnResult(ColumnCardHandling Handling, long? TargetColumnId);

/// <summary>
/// Confirms deleting a column. When it holds cards the user must choose to move them (the default)
/// or explicitly delete them; cards are never removed silently.
/// </summary>
public sealed partial class DeleteColumnDialogViewModel : DialogViewModel<DeleteColumnResult>
{
    public DeleteColumnDialogViewModel(BoardColumn column, ColumnCardCount count, IReadOnlyList<BoardColumn> otherColumns)
        : base($"Delete column '{column.Name}'?")
    {
        CardCount = count;
        OtherColumns = otherColumns;
        SelectedTarget = otherColumns.FirstOrDefault();
        MoveCards = HasCards && otherColumns.Count > 0;
        DeleteCards = HasCards && otherColumns.Count == 0;
    }

    public ColumnCardCount CardCount { get; }

    public bool HasCards => CardCount.Total > 0;

    public bool CanMoveCards => OtherColumns.Count > 0;

    public IReadOnlyList<BoardColumn> OtherColumns { get; }

    public string Message => HasCards
        ? $"This column holds {Describe(CardCount)}. What should happen to them?"
        : "This column is empty. Deleting it cannot be undone.";

    public override string ConfirmText => DeleteCards ? "Delete column and cards" : "Delete column";

    public override bool IsDestructive => true;

    [ObservableProperty]
    public partial BoardColumn? SelectedTarget { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConfirmText))]
    public partial bool MoveCards { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ConfirmText))]
    public partial bool DeleteCards { get; set; }

    protected override DeleteColumnResult BuildResult()
    {
        if (!HasCards)
        {
            return new DeleteColumnResult(ColumnCardHandling.RefuseIfNotEmpty, null);
        }

        if (MoveCards)
        {
            return SelectedTarget is { } target
                ? new DeleteColumnResult(ColumnCardHandling.MoveToColumn, target.Id)
                : throw new ValidationException("Choose the column the cards should move to.");
        }

        return DeleteCards
            ? new DeleteColumnResult(ColumnCardHandling.DeleteCards, null)
            : throw new ValidationException("Choose whether to move or delete the cards.");
    }

    private static string Describe(ColumnCardCount count) =>
        count.Archived == 0
            ? Plural(count.Active, "card")
            : $"{Plural(count.Active, "card")} and {Plural(count.Archived, "archived card")}";

    private static string Plural(int n, string noun) => n == 1 ? $"1 {noun}" : $"{n} {noun}s";
}
