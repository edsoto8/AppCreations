using System.Collections.ObjectModel;
using BoardFlow.Core.Domain;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels;

/// <summary>A column on the board with its visible (filtered) cards and its quick-add box.</summary>
public sealed partial class ColumnViewModel(BoardViewModel board, BoardColumn column) : ObservableObject
{
    public BoardViewModel Board { get; } = board;

    public long Id { get; } = column.Id;

    public BoardColumn Column { get; private set; } = column;

    [ObservableProperty]
    public partial string Name { get; private set; } = column.Name;

    /// <summary>The cards currently shown (after search/filter), in board order.</summary>
    public ObservableCollection<CardItemViewModel> Cards { get; } = [];

    /// <summary>All active cards in the column, whether or not the filter shows them.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CountText))]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    public partial int TotalCount { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CountText))]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    [NotifyPropertyChangedFor(nameof(IsFilteredEmpty))]
    public partial int VisibleCount { get; private set; }

    [ObservableProperty]
    public partial bool IsVisible { get; set; } = true;

    [ObservableProperty]
    public partial bool IsFirst { get; set; }

    [ObservableProperty]
    public partial bool IsLast { get; set; }

    [ObservableProperty]
    public partial bool IsQuickAddOpen { get; set; }

    [ObservableProperty]
    public partial string QuickAddText { get; set; } = "";

    public string CountText => VisibleCount == TotalCount ? $"{TotalCount}" : $"{VisibleCount} of {TotalCount}";

    /// <summary>No cards at all: show the "drop or add cards here" hint.</summary>
    public bool IsEmpty => TotalCount == 0;

    /// <summary>Cards exist but the filter hides all of them.</summary>
    public bool IsFilteredEmpty => TotalCount > 0 && VisibleCount == 0;

    public void Update(BoardColumn column)
    {
        Column = column;
        Name = column.Name;
    }

    public void SetCards(IReadOnlyList<CardItemViewModel> visible, int total)
    {
        Cards.SyncTo(visible);
        TotalCount = total;
        VisibleCount = visible.Count;
    }

    [RelayCommand]
    private void OpenQuickAdd()
    {
        foreach (var other in Board.Columns.Where(c => c != this))
        {
            other.IsQuickAddOpen = false;
        }

        IsQuickAddOpen = true;
    }

    [RelayCommand]
    private void SubmitQuickAdd()
    {
        if (Board.QuickAdd(this, QuickAddText))
        {
            QuickAddText = "";
        }
    }

    [RelayCommand]
    private void CancelQuickAdd()
    {
        QuickAddText = "";
        IsQuickAddOpen = false;
    }
}
