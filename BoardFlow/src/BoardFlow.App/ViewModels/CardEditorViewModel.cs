using System.Collections.ObjectModel;
using System.Globalization;
using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels;

public sealed partial class LabelChoice(LabelChip label, bool isSelected) : ObservableObject
{
    public LabelChip Label { get; } = label;

    [ObservableProperty]
    public partial bool IsSelected { get; set; } = isSelected;
}

/// <summary>The card detail panel: create a card or edit every field of an existing one.</summary>
public sealed partial class CardEditorViewModel : ViewModelBase, IPanel
{
    private readonly BoardViewModel _board;
    private Card? _card;
    private string _savedState = "";

    public CardEditorViewModel(BoardServices services, BoardViewModel board, Card? card, long columnId)
        : base(services)
    {
        _board = board;
        _card = card;
        ColumnChoices = board.Columns.Select(c => c.Column).ToList();
        LabelChoices = new ObservableCollection<LabelChoice>(
            board.Labels.Select(l => new LabelChoice(l, card?.LabelIds.Contains(l.Id) == true)));

        Title = card?.Title ?? "";
        Description = card?.Description ?? "";
        Priority = card?.Priority ?? Priority.None;
        DueDate = card?.DueDate?.ToDateTime(TimeOnly.MinValue);
        SelectedColumn = ColumnChoices.FirstOrDefault(c => c.Id == (card?.ColumnId ?? columnId)) ?? ColumnChoices.FirstOrDefault();
        MarkSaved();
    }

    public bool IsNew => _card is null;

    public string Heading => IsNew ? "New card" : "Card details";

    public string SaveText => IsNew ? "Create card" : "Save";

    public IReadOnlyList<Priority> PriorityChoices { get; } = Enum.GetValues<Priority>();

    public IReadOnlyList<BoardColumn> ColumnChoices { get; }

    public ObservableCollection<LabelChoice> LabelChoices { get; }

    public bool HasLabelChoices => LabelChoices.Count > 0;

    public bool IsArchived => _card?.IsArchived == true;

    public string ArchiveText => IsArchived ? "Restore" : "Archive";

    public string? MetaText => _card is null
        ? null
        : $"Created {Local(_card.CreatedAt)} · Updated {Local(_card.UpdatedAt)}";

    [ObservableProperty]
    public partial string Title { get; set; }

    [ObservableProperty]
    public partial string Description { get; set; }

    [ObservableProperty]
    public partial Priority Priority { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDueDate))]
    public partial DateTime? DueDate { get; set; }

    public bool HasDueDate => DueDate is not null;

    [ObservableProperty]
    public partial BoardColumn? SelectedColumn { get; set; }

    [ObservableProperty]
    public partial string NewLabelName { get; set; } = "";

    /// <summary>Inline validation message shown above the buttons.</summary>
    [ObservableProperty]
    public partial string? Error { get; set; }

    public bool IsDirty => CurrentState() != _savedState;

    public async Task<bool> CanCloseAsync() =>
        !IsDirty || await Services.Dialogs.ConfirmAsync(
            "Discard changes?", "This card has unsaved changes. Close it and lose them?", "Discard changes", isDestructive: true);

    [RelayCommand]
    public void Save()
    {
        if (SaveCore())
        {
            Services.Panels.ForceClose(this);
        }
    }

    [RelayCommand]
    private async Task Cancel() => await Services.Panels.CloseAsync();

    [RelayCommand]
    private void ClearDueDate() => DueDate = null;

    [RelayCommand]
    private async Task ToggleArchive()
    {
        if (_card is null || (IsDirty && !SaveCore()))
        {
            return;
        }

        var archive = !_card.IsArchived;
        if (Try(() => Services.Cards.SetArchived(_card.Id, archive), archive ? "archive the card" : "restore the card"))
        {
            Services.Panels.ForceClose(this);
            _board.Reload();
            Services.Notifier.Info(archive
                ? $"Archived '{_card.Title}'. Restore it from the Archive."
                : $"Restored '{_card.Title}'.");
        }

        await Task.CompletedTask;
    }

    [RelayCommand]
    private async Task Duplicate()
    {
        if (_card is null || (IsDirty && !SaveCore()))
        {
            return;
        }

        Card? copy = null;
        if (Try(() => copy = Services.Cards.Duplicate(_card.Id), "duplicate the card") && copy is not null)
        {
            _board.Reload();
            Services.Panels.ForceClose(this);
            await Services.Panels.OpenAsync(new CardEditorViewModel(Services, _board, copy, copy.ColumnId));
            Services.Notifier.Info($"Created '{copy.Title}'.");
        }
    }

    [RelayCommand]
    private async Task Delete()
    {
        if (_card is null)
        {
            return;
        }

        var confirmed = await Services.Dialogs.ConfirmAsync(
            "Delete card?",
            $"'{_card.Title}' will be permanently deleted. To keep it out of the way instead, archive it.",
            "Delete card",
            isDestructive: true);
        if (confirmed && Try(() => Services.Cards.Delete(_card.Id), "delete the card"))
        {
            Services.Panels.ForceClose(this);
            _board.Reload();
        }
    }

    [RelayCommand]
    private void AddLabel()
    {
        var used = LabelChoices.Select(c => c.Label.Color).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var color = LabelColors.Palette.FirstOrDefault(c => !used.Contains(c)) ?? LabelColors.Palette[LabelChoices.Count % LabelColors.Palette.Count];
        Label? label = null;
        if (Try(() => label = Services.Labels.Create(_board.Board.WorkspaceId, NewLabelName, color), "create the label") && label is not null)
        {
            LabelChoices.Add(new LabelChoice(LabelChip.From(label), isSelected: true));
            OnPropertyChanged(nameof(HasLabelChoices));
            NewLabelName = "";
            _board.Reload();
        }
    }

    /// <summary>Validates and writes the card. Keeps the panel open with an inline error on failure.</summary>
    private bool SaveCore()
    {
        Error = null;
        CardInput input;
        try
        {
            input = new CardInput(
                Validate.CardTitle(Title),
                Validate.Description(Description),
                Priority,
                DueDate is { } due ? DateOnly.FromDateTime(due) : null,
                LabelChoices.Where(c => c.IsSelected).Select(c => c.Label.Id).ToList());
        }
        catch (ValidationException ex)
        {
            Error = ex.Message;
            return false;
        }

        if (SelectedColumn is not { } column)
        {
            Error = "Choose a column for the card.";
            return false;
        }

        var saved = Try(() =>
        {
            if (_card is null)
            {
                _card = Services.Cards.Create(column.Id, input);
            }
            else
            {
                _card = Services.Cards.Update(_card.Id, input);
                if (_card.ColumnId != column.Id && !_card.IsArchived)
                {
                    Services.Cards.Move(_card.Id, column.Id, null);
                    _card = Services.Cards.Get(_card.Id) ?? _card;
                }
            }
        }, IsNew ? "create the card" : "save the card");

        _board.Reload();
        if (saved)
        {
            MarkSaved();
            OnPropertyChanged(nameof(IsNew));
            OnPropertyChanged(nameof(Heading));
            OnPropertyChanged(nameof(SaveText));
            OnPropertyChanged(nameof(MetaText));
        }

        return saved;
    }

    private void MarkSaved() => _savedState = CurrentState();

    private string CurrentState() => string.Join('\u001f',
        Title, Description, (int)Priority, DueDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
        SelectedColumn?.Id ?? 0,
        string.Join(',', LabelChoices.Where(c => c.IsSelected).Select(c => c.Label.Id)));

    private static string Local(DateTime utc) => utc.ToLocalTime().ToString("MMM d, yyyy HH:mm", CultureInfo.CurrentCulture);
}
