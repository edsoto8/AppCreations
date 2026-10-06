using System.Collections.ObjectModel;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels;

/// <summary>
/// One open board. After every change it reloads from the database, so what is shown is always what is
/// stored; view model instances are reused by id so the UI keeps focus and scroll position.
/// </summary>
public sealed partial class BoardViewModel : ViewModelBase
{
    private readonly Dictionary<long, CardItemViewModel> _cardCache = [];
    private readonly Dictionary<long, List<long>> _activeOrder = [];
    private IReadOnlyDictionary<long, LabelChip> _labelsById = new Dictionary<long, LabelChip>();
    private bool _suppressFilter;

    public BoardViewModel(BoardServices services, Board board)
        : base(services)
    {
        Board = board;
        Name = board.Name;
        Description = board.Description;
        PriorityOptions = Enum.GetValues<Priority>()
            .Select(p => new FilterOption((long)p, p.ToString(), null, ApplyFilter))
            .ToList();
        SelectedDue = DueOptions[0];
        Reload();
    }

    public Board Board { get; private set; }

    public long Id => Board.Id;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDescription))]
    public partial string Name { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDescription))]
    public partial string Description { get; private set; }

    public bool HasDescription => Description.Length > 0;

    public ObservableCollection<ColumnViewModel> Columns { get; } = [];

    public IReadOnlyList<LabelChip> Labels { get; private set; } = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasColumns))]
    public partial int ColumnCount { get; private set; }

    public bool HasColumns => ColumnCount > 0;

    [ObservableProperty]
    public partial int TotalCards { get; private set; }

    [ObservableProperty]
    public partial int VisibleCards { get; private set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ArchiveText))]
    public partial int ArchivedCount { get; private set; }

    public string ArchiveText => ArchivedCount == 0 ? "Archive" : $"Archive ({ArchivedCount})";

    // ---- Search and filter -------------------------------------------------------------------

    [ObservableProperty]
    public partial string SearchText { get; set; } = "";

    public IReadOnlyList<FilterOption> PriorityOptions { get; }

    public ObservableCollection<FilterOption> LabelOptions { get; } = [];

    public ObservableCollection<FilterOption> ColumnOptions { get; } = [];

    public bool HasLabelOptions => LabelOptions.Count > 0;

    public IReadOnlyList<DueFilterOption> DueOptions { get; } =
    [
        new(DueFilter.Any, "Any due date"),
        new(DueFilter.Overdue, "Overdue"),
        new(DueFilter.DueToday, "Due today"),
        new(DueFilter.DueThisWeek, $"Due in the next {DueDates.SoonDays} days"),
        new(DueFilter.HasDueDate, "Has a due date"),
        new(DueFilter.NoDueDate, "No due date"),
    ];

    [ObservableProperty]
    public partial DueFilterOption SelectedDue { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FilterButtonText))]
    public partial int ActiveFilterCount { get; private set; }

    [ObservableProperty]
    public partial bool IsFilterActive { get; private set; }

    [ObservableProperty]
    public partial string FilterSummary { get; private set; } = "";

    public string FilterButtonText => ActiveFilterCount == 0 ? "Filter" : $"Filter ({ActiveFilterCount})";

    public CardFilter CurrentFilter { get; private set; } = CardFilter.None;

    partial void OnSearchTextChanged(string value) => ApplyFilter();

    partial void OnSelectedDueChanged(DueFilterOption value) => ApplyFilter();

    [RelayCommand]
    public void ClearFilters()
    {
        _suppressFilter = true;
        SearchText = "";
        SelectedDue = DueOptions[0];
        foreach (var option in PriorityOptions.Concat(LabelOptions).Concat(ColumnOptions))
        {
            option.IsSelected = false;
        }

        _suppressFilter = false;
        ApplyFilter();
    }

    // ---- Loading ------------------------------------------------------------------------------

    /// <summary>Re-reads the board, its columns, cards and labels from the database.</summary>
    public void Reload()
    {
        Try(() =>
        {
            var board = Services.Boards.Get(Id);
            if (board is null)
            {
                return;
            }

            Board = board;
            Name = board.Name;
            Description = board.Description;

            var columns = Services.Columns.GetByBoard(Id);
            var cards = Services.Cards.GetByBoard(Id);
            var labels = Services.Labels.GetByWorkspace(board.WorkspaceId);
            ArchivedCount = Services.Cards.GetArchivedByBoard(Id).Count;

            Labels = labels.Select(LabelChip.From).ToList();
            _labelsById = Labels.ToDictionary(l => l.Id);
            OnPropertyChanged(nameof(Labels));

            var today = Services.Clock.Today;
            var seen = new HashSet<long>();
            foreach (var card in cards)
            {
                seen.Add(card.Id);
                if (_cardCache.TryGetValue(card.Id, out var existing))
                {
                    existing.Update(card, _labelsById, today);
                }
                else
                {
                    _cardCache[card.Id] = new CardItemViewModel(card, _labelsById, today);
                }
            }

            foreach (var gone in _cardCache.Keys.Where(id => !seen.Contains(id)).ToList())
            {
                _cardCache.Remove(gone);
            }

            _activeOrder.Clear();
            foreach (var column in columns)
            {
                _activeOrder[column.Id] = [];
            }

            foreach (var card in cards)
            {
                _activeOrder[card.ColumnId].Add(card.Id);
            }

            var existingColumns = Columns.ToDictionary(c => c.Id);
            var desired = new List<ColumnViewModel>();
            foreach (var column in columns)
            {
                if (existingColumns.TryGetValue(column.Id, out var vm))
                {
                    vm.Update(column);
                }
                else
                {
                    vm = new ColumnViewModel(this, column);
                }

                desired.Add(vm);
            }

            Columns.SyncTo(desired);
            for (var i = 0; i < Columns.Count; i++)
            {
                Columns[i].IsFirst = i == 0;
                Columns[i].IsLast = i == Columns.Count - 1;
            }

            ColumnCount = Columns.Count;
            TotalCards = cards.Count;
            SyncFilterOptions(labels, columns);
            ApplyFilter();
        }, "load the board");
    }

    protected override void OnStaleData() => Reload();

    private void SyncFilterOptions(IReadOnlyList<Label> labels, IReadOnlyList<BoardColumn> columns)
    {
        _suppressFilter = true;
        Sync(LabelOptions, labels.Select(l => (l.Id, l.Name, (string?)l.DisplayColor)));
        Sync(ColumnOptions, columns.Select(c => (c.Id, c.Name, (string?)null)));
        _suppressFilter = false;
        OnPropertyChanged(nameof(HasLabelOptions));

        void Sync(ObservableCollection<FilterOption> options, IEnumerable<(long Id, string Name, string? Color)> items)
        {
            var selected = options.Where(o => o.IsSelected).Select(o => o.Key).ToHashSet();
            var fresh = items.Select(i => new FilterOption(i.Id, i.Name, i.Color, ApplyFilter) { IsSelected = selected.Contains(i.Id) }).ToList();
            options.Clear();
            foreach (var option in fresh)
            {
                options.Add(option);
            }
        }
    }

    /// <summary>Recomputes which cards each column shows from the current search and filter.</summary>
    public void ApplyFilter()
    {
        if (_suppressFilter)
        {
            return;
        }

        var filter = new CardFilter
        {
            SearchText = SearchText.Trim(),
            Priorities = PriorityOptions.Where(o => o.IsSelected).Select(o => (Priority)o.Key).ToHashSet(),
            LabelIds = LabelOptions.Where(o => o.IsSelected).Select(o => o.Key).ToHashSet(),
            ColumnIds = ColumnOptions.Where(o => o.IsSelected).Select(o => o.Key).ToHashSet(),
            Due = SelectedDue.Value,
        };
        CurrentFilter = filter;

        var today = Services.Clock.Today;
        var visibleTotal = 0;
        foreach (var column in Columns)
        {
            var all = _activeOrder.GetValueOrDefault(column.Id) ?? [];
            var visible = all.Select(id => _cardCache[id]).Where(card => filter.Matches(card.Card, today)).ToList();
            column.IsVisible = filter.ColumnIds.Count == 0 || filter.ColumnIds.Contains(column.Id);
            column.SetCards(column.IsVisible ? visible : [], all.Count);
            visibleTotal += column.IsVisible ? visible.Count : 0;
        }

        VisibleCards = visibleTotal;
        IsFilterActive = !filter.IsEmpty;
        ActiveFilterCount =
            (string.IsNullOrWhiteSpace(filter.SearchText) ? 0 : 1)
            + filter.Priorities.Count + filter.LabelIds.Count + filter.ColumnIds.Count
            + (filter.Due == DueFilter.Any ? 0 : 1);
        FilterSummary = IsFilterActive ? $"Showing {VisibleCards} of {TotalCards} cards" : "";
    }

    // ---- Columns --------------------------------------------------------------------------------

    [RelayCommand]
    private async Task AddColumn()
    {
        var name = await Services.Dialogs.PromptAsync(
            "Add column", "Column name", "", "Add column", text => Validate.Name(text, "Column name"));
        if (name is not null && Try(() => Services.Columns.Create(Id, name), "add the column"))
        {
            Reload();
        }
    }

    [RelayCommand]
    private void AddDefaultColumns()
    {
        if (Try(() => Services.Columns.AddDefaultColumns(Id), "add the default columns"))
        {
            Reload();
        }
    }

    [RelayCommand]
    private async Task RenameColumn(ColumnViewModel column)
    {
        var name = await Services.Dialogs.PromptAsync(
            "Rename column", "Column name", column.Name, "Rename", text => Validate.Name(text, "Column name"));
        if (name is not null && Try(() => Services.Columns.Rename(column.Id, name), "rename the column"))
        {
            Reload();
        }
    }

    [RelayCommand]
    private async Task DeleteColumn(ColumnViewModel column)
    {
        var count = Services.Columns.CountCards(column.Id);
        var others = Columns.Where(c => c.Id != column.Id).Select(c => c.Column).ToList();
        var choice = await Services.Dialogs.ShowAsync(new DeleteColumnDialogViewModel(column.Column, count, others));
        if (choice is not null
            && Try(() => Services.Columns.Delete(column.Id, choice.Handling, choice.TargetColumnId), "delete the column"))
        {
            Reload();
        }
    }

    [RelayCommand]
    private void MoveColumnLeft(ColumnViewModel column) => MoveColumnBy(column, -1);

    [RelayCommand]
    private void MoveColumnRight(ColumnViewModel column) => MoveColumnBy(column, 1);

    private void MoveColumnBy(ColumnViewModel column, int offset)
    {
        if (Try(() => Services.Columns.MoveBy(column.Id, offset), "move the column"))
        {
            Reload();
        }
    }

    /// <summary>Drag-and-drop target: place the column left of <paramref name="beforeColumnId"/>, or last.</summary>
    public void MoveColumn(long columnId, long? beforeColumnId)
    {
        if (beforeColumnId == columnId)
        {
            return;
        }

        if (Try(() => Services.Columns.Move(columnId, beforeColumnId), "move the column"))
        {
            Reload();
        }
    }

    // ---- Cards ----------------------------------------------------------------------------------

    /// <summary>Creates a card with just a title at the bottom of <paramref name="column"/>.</summary>
    public bool QuickAdd(ColumnViewModel column, string title)
    {
        Card? created = null;
        if (!Try(() => created = Services.Cards.Create(column.Id, new CardInput(title)), "add the card"))
        {
            return false;
        }

        Reload();
        if (created is not null && IsFilterActive && !CurrentFilter.Matches(created, Services.Clock.Today))
        {
            Services.Notifier.Info($"Added '{created.Title}'. It is hidden by the current filter.");
        }

        return true;
    }

    /// <summary>Ctrl+N: open the quick-add box of the first visible column.</summary>
    public bool BeginQuickAdd()
    {
        var column = Columns.FirstOrDefault(c => c.IsVisible);
        if (column is null)
        {
            Services.Notifier.Info("Add a column first, then you can add cards to it.");
            return false;
        }

        column.OpenQuickAddCommand.Execute(null);
        return true;
    }

    /// <summary>
    /// Drag-and-drop target: move the card into <paramref name="columnId"/> above
    /// <paramref name="beforeCardId"/>, or to the bottom when null.
    /// </summary>
    public void MoveCard(long cardId, long columnId, long? beforeCardId)
    {
        if (Try(() => Services.Cards.Move(cardId, columnId, beforeCardId), "move the card"))
        {
            Reload();
        }
    }

    /// <summary>Keyboard reorder: move the card up (-1) or down (+1) within its column.</summary>
    public void MoveCardVertically(CardItemViewModel card, int direction)
    {
        if (!_activeOrder.TryGetValue(card.ColumnId, out var order))
        {
            return;
        }

        var index = order.IndexOf(card.Id);
        var target = index + direction;
        if (index < 0 || target < 0 || target >= order.Count)
        {
            return;
        }

        // Moving down by one means "before the card two places below", or the end of the column.
        long? before = direction < 0 ? order[target] : (target + 1 < order.Count ? order[target + 1] : null);
        MoveCard(card.Id, card.ColumnId, before);
    }

    /// <summary>Keyboard move: send the card to the bottom of the previous (-1) or next (+1) visible column.</summary>
    public void MoveCardToAdjacentColumn(CardItemViewModel card, int direction)
    {
        var visible = Columns.Where(c => c.IsVisible).ToList();
        var index = visible.FindIndex(c => c.Id == card.ColumnId);
        var target = index + direction;
        if (index < 0 || target < 0 || target >= visible.Count)
        {
            return;
        }

        MoveCard(card.Id, visible[target].Id, null);
    }

    public CardItemViewModel? FindCard(long id) => _cardCache.GetValueOrDefault(id);

    [RelayCommand]
    private async Task OpenCard(CardItemViewModel card)
    {
        var fresh = Services.Cards.Get(card.Id);
        if (fresh is null)
        {
            Services.Notifier.Error("That card no longer exists. The board has been refreshed.");
            Reload();
            return;
        }

        await Services.Panels.OpenAsync(new CardEditorViewModel(Services, this, fresh, fresh.ColumnId));
    }

    [RelayCommand]
    private async Task NewCard(ColumnViewModel column) =>
        await Services.Panels.OpenAsync(new CardEditorViewModel(Services, this, null, column.Id));

    [RelayCommand]
    private async Task OpenArchive() => await Services.Panels.OpenAsync(new ArchiveViewModel(Services, this));
}
