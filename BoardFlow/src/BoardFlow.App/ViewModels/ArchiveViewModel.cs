using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels;

public sealed record ArchivedCardItem(long Id, string Title, string ColumnName, string ArchivedText, IReadOnlyList<LabelChip> Labels);

/// <summary>The archive browser: archived cards of the open board, with restore and permanent delete.</summary>
public sealed partial class ArchiveViewModel : ViewModelBase, IPanel
{
    private readonly BoardViewModel _board;

    public ArchiveViewModel(BoardServices services, BoardViewModel board)
        : base(services)
    {
        _board = board;
        Load();
    }

    public string BoardName => _board.Name;

    public ObservableCollection<ArchivedCardItem> Items { get; } = [];

    [ObservableProperty]
    public partial bool IsEmpty { get; private set; }

    public Task<bool> CanCloseAsync() => Task.FromResult(true);

    [RelayCommand]
    private async Task Close() => await Services.Panels.CloseAsync();

    [RelayCommand]
    private void Restore(ArchivedCardItem item)
    {
        if (Try(() => Services.Cards.SetArchived(item.Id, false), "restore the card"))
        {
            Services.Notifier.Info($"Restored '{item.Title}' to {item.ColumnName}.");
            Refresh();
        }
    }

    [RelayCommand]
    private async Task Delete(ArchivedCardItem item)
    {
        var confirmed = await Services.Dialogs.ConfirmAsync(
            "Delete card permanently?", $"'{item.Title}' will be deleted and cannot be restored.", "Delete card", isDestructive: true);
        if (confirmed && Try(() => Services.Cards.Delete(item.Id), "delete the card"))
        {
            Refresh();
        }
    }

    protected override void OnStaleData() => Refresh();

    private void Refresh()
    {
        Load();
        _board.Reload();
    }

    private void Load()
    {
        Try(() =>
        {
            var columns = Services.Columns.GetByBoard(_board.Id).ToDictionary(c => c.Id, c => c.Name);
            var labels = _board.Labels.ToDictionary(l => l.Id);
            Items.Clear();
            foreach (var card in Services.Cards.GetArchivedByBoard(_board.Id))
            {
                Items.Add(new ArchivedCardItem(
                    card.Id,
                    card.Title,
                    columns.GetValueOrDefault(card.ColumnId, "?"),
                    "Archived " + card.UpdatedAt.ToLocalTime().ToString("MMM d, yyyy", CultureInfo.CurrentCulture),
                    card.LabelIds.Where(labels.ContainsKey).Select(id => labels[id]).ToList()));
            }

            IsEmpty = Items.Count == 0;
        }, "load the archive");
    }
}
