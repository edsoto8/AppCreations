using System.Collections.ObjectModel;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using BoardFlow.Data.Repositories;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.Extensions.Logging;

namespace BoardFlow.App.ViewModels;

/// <summary>The window: workspace and board navigation, the open board, and the overlay hosts.</summary>
public sealed partial class MainViewModel(BoardServices services) : ViewModelBase(services)
{
    private bool _loading;
    private DateOnly _today = services.Clock.Today;

    public DialogHost Dialogs => Services.Dialogs;

    public PanelHost Panels => Services.Panels;

    public Notifier Notifier => Services.Notifier;

    public ObservableCollection<Workspace> Workspaces { get; } = [];

    public ObservableCollection<Board> Boards { get; } = [];

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasWorkspace))]
    [NotifyPropertyChangedFor(nameof(ShowNoWorkspace))]
    [NotifyPropertyChangedFor(nameof(ShowNoBoard))]
    public partial Workspace? SelectedWorkspace { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowNoBoard))]
    public partial Board? SelectedBoard { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasBoard))]
    [NotifyPropertyChangedFor(nameof(ShowNoBoard))]
    public partial BoardViewModel? CurrentBoard { get; private set; }

    public bool HasWorkspace => SelectedWorkspace is not null;

    public bool HasBoards => Boards.Count > 0;

    public bool HasBoard => CurrentBoard is not null;

    /// <summary>First run (or every workspace deleted): show the welcome state.</summary>
    public bool ShowNoWorkspace => SelectedWorkspace is null;

    /// <summary>A workspace without boards (or none selected): show the "create a board" state.</summary>
    public bool ShowNoBoard => SelectedWorkspace is not null && CurrentBoard is null;

    /// <summary>Loads workspaces and reopens the board that was open last time.</summary>
    public void Initialize()
    {
        Try(() =>
        {
            var lastWorkspace = Services.Settings.GetLong(SettingsRepository.LastWorkspaceId);
            var lastBoard = Services.Settings.GetLong(SettingsRepository.LastBoardId);
            LoadWorkspaces(lastWorkspace, lastBoard);
        }, "load your workspaces");
    }

    protected override void OnStaleData() => LoadWorkspaces(SelectedWorkspace?.Id, SelectedBoard?.Id);

    partial void OnSelectedWorkspaceChanged(Workspace? oldValue, Workspace? newValue)
    {
        if (!_loading)
        {
            _ = SwitchAsync(() => LoadBoards(null), () => SelectedWorkspace = oldValue);
        }
    }

    partial void OnSelectedBoardChanged(Board? oldValue, Board? newValue)
    {
        if (!_loading)
        {
            _ = SwitchAsync(() => OpenBoard(newValue), () => SelectedBoard = oldValue);
        }
    }

    /// <summary>
    /// Switching away must not strand an open panel (e.g. a card editor with unsaved changes) on the old
    /// board: the panel is asked to close first, and if it refuses the selection is put back.
    /// </summary>
    private async Task SwitchAsync(Action switchTo, Action restoreSelection)
    {
        try
        {
            if (await Services.Panels.CloseAsync())
            {
                switchTo();
                return;
            }

            _loading = true;
            try
            {
                restoreSelection();
            }
            finally
            {
                _loading = false;
            }
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Switching workspace or board failed");
            Services.Notifier.Error("Could not switch: something unexpected went wrong. Details are in the log file.");
        }
    }

    /// <summary>Called periodically: refreshes due-date badges and filters when the date changes.</summary>
    public void CheckDateRollover()
    {
        var today = Services.Clock.Today;
        if (today != _today)
        {
            _today = today;
            CurrentBoard?.Reload();
        }
    }

    // ---- Workspaces -------------------------------------------------------------------------------

    [RelayCommand]
    private async Task NewWorkspace()
    {
        var name = await Services.Dialogs.PromptAsync(
            "New workspace", "Workspace name", "", "Create workspace", text => Validate.Name(text, "Workspace name"));
        Workspace? created = null;
        if (name is not null && Try(() => created = Services.Workspaces.Create(name), "create the workspace"))
        {
            LoadWorkspaces(created!.Id, null);
        }
    }

    [RelayCommand]
    private async Task RenameWorkspace()
    {
        if (SelectedWorkspace is not { } workspace)
        {
            return;
        }

        var name = await Services.Dialogs.PromptAsync(
            "Rename workspace", "Workspace name", workspace.Name, "Rename", text => Validate.Name(text, "Workspace name"));
        if (name is not null && Try(() => Services.Workspaces.Rename(workspace.Id, name), "rename the workspace"))
        {
            LoadWorkspaces(workspace.Id, SelectedBoard?.Id);
        }
    }

    [RelayCommand]
    private async Task DeleteWorkspace()
    {
        if (SelectedWorkspace is not { } workspace)
        {
            return;
        }

        WorkspaceContents? contents = null;
        if (!Try(() => contents = Services.Workspaces.GetContents(workspace.Id), "check the workspace"))
        {
            return;
        }

        var message = contents!.Boards == 0
            ? $"Delete the empty workspace '{workspace.Name}'?"
            : $"'{workspace.Name}' contains {Text.Plural(contents.Boards, "board")} and {Text.Plural(contents.Cards, "card")}. " +
              "Everything in it, including its labels, will be permanently deleted.";
        if (!await Services.Dialogs.ConfirmAsync("Delete workspace?", message, "Delete workspace", isDestructive: true))
        {
            return;
        }

        if (await Services.Panels.CloseAsync() && Try(() => Services.Workspaces.Delete(workspace.Id), "delete the workspace"))
        {
            Services.Notifier.Info($"Deleted workspace '{workspace.Name}'.");
            LoadWorkspaces(null, null);
        }
    }

    [RelayCommand]
    private async Task ManageLabels()
    {
        if (SelectedWorkspace is { } workspace)
        {
            await Services.Panels.OpenAsync(new LabelsViewModel(Services, workspace.Id, workspace.Name, () => CurrentBoard?.Reload()));
        }
    }

    // ---- Boards -------------------------------------------------------------------------------------

    [RelayCommand]
    private async Task NewBoard()
    {
        if (SelectedWorkspace is not { } workspace)
        {
            return;
        }

        var result = await Services.Dialogs.ShowAsync(new BoardDialogViewModel());
        Board? created = null;
        if (result is not null && Try(
                () => created = Services.Boards.Create(workspace.Id, result.Name, result.Description, result.AddDefaultColumns),
                "create the board"))
        {
            LoadBoards(created!.Id);
        }
    }

    [RelayCommand]
    private async Task EditBoard()
    {
        if (CurrentBoard is not { } board)
        {
            return;
        }

        var result = await Services.Dialogs.ShowAsync(new BoardDialogViewModel(board.Name, board.Description));
        if (result is not null && Try(() => Services.Boards.Update(board.Id, result.Name, result.Description), "save the board"))
        {
            LoadBoards(board.Id);
        }
    }

    [RelayCommand]
    private async Task DeleteBoard()
    {
        if (CurrentBoard is not { } board)
        {
            return;
        }

        BoardContents? contents = null;
        if (!Try(() => contents = Services.Boards.GetContents(board.Id), "check the board"))
        {
            return;
        }

        var message = contents!.Cards == 0
            ? $"Delete the board '{board.Name}' and its {Text.Plural(contents.Columns, "column")}?"
            : $"'{board.Name}' has {Text.Plural(contents.Columns, "column")} and {Text.Plural(contents.Cards, "card")} " +
              "(including archived). They will be permanently deleted.";
        if (!await Services.Dialogs.ConfirmAsync("Delete board?", message, "Delete board", isDestructive: true))
        {
            return;
        }

        if (await Services.Panels.CloseAsync() && Try(() => Services.Boards.Delete(board.Id), "delete the board"))
        {
            Services.Notifier.Info($"Deleted board '{board.Name}'.");
            LoadBoards(null);
        }
    }

    // ---- Keyboard shortcuts ------------------------------------------------------------------------

    /// <summary>Ctrl+N: quick-add a card on the open board.</summary>
    [RelayCommand]
    private void QuickAddCard()
    {
        if (Services.Dialogs.Current is null && Services.Panels.Current is null)
        {
            CurrentBoard?.BeginQuickAdd();
        }
    }

    /// <summary>F1: list the keyboard shortcuts.</summary>
    [RelayCommand]
    private async Task ShowShortcuts()
    {
        if (Services.Dialogs.Current is null)
        {
            await Services.Dialogs.ShowAsync(new ShortcutsDialogViewModel());
        }
    }

    /// <summary>Escape: close the dialog if one is open, otherwise the side panel. Returns whether anything closed.</summary>
    public async Task<bool> CloseTopmostAsync()
    {
        if (Services.Dialogs.Current is { } dialog)
        {
            dialog.Cancel();
            return true;
        }

        if (Services.Panels.Current is not null)
        {
            await Services.Panels.CloseAsync();
            return true;
        }

        return false;
    }

    // ---- Loading ---------------------------------------------------------------------------------------

    private void LoadWorkspaces(long? selectWorkspaceId, long? selectBoardId)
    {
        Try(() =>
        {
            _loading = true;
            try
            {
                var workspaces = Services.Workspaces.GetAll();
                Workspaces.Clear();
                foreach (var workspace in workspaces)
                {
                    Workspaces.Add(workspace);
                }

                SelectedWorkspace = Workspaces.FirstOrDefault(w => w.Id == selectWorkspaceId) ?? Workspaces.FirstOrDefault();
            }
            finally
            {
                _loading = false;
            }

            LoadBoards(selectBoardId);
        }, "load your workspaces");
    }

    private void LoadBoards(long? selectBoardId)
    {
        Try(() =>
        {
            _loading = true;
            Board? select;
            try
            {
                Boards.Clear();
                if (SelectedWorkspace is { } workspace)
                {
                    foreach (var board in Services.Boards.GetByWorkspace(workspace.Id))
                    {
                        Boards.Add(board);
                    }
                }

                OnPropertyChanged(nameof(HasBoards));
                select = Boards.FirstOrDefault(b => b.Id == selectBoardId) ?? Boards.FirstOrDefault();
                SelectedBoard = select;
            }
            finally
            {
                _loading = false;
            }

            OpenBoard(select);
        }, "load the boards");
    }

    /// <summary>Shows <paramref name="board"/>. Callers have already closed (or never opened) any side panel.</summary>
    private void OpenBoard(Board? board)
    {
        if (Services.Panels.Current is { } stale)
        {
            Services.Panels.ForceClose(stale);
        }

        if (board is null)
        {
            CurrentBoard = null;
        }
        else if (CurrentBoard?.Id == board.Id)
        {
            CurrentBoard.Reload();
        }
        else
        {
            CurrentBoard = new BoardViewModel(Services, board);
        }

        Try(() =>
        {
            Services.Settings.Set(SettingsRepository.LastWorkspaceId, SelectedWorkspace?.Id.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Services.Settings.Set(SettingsRepository.LastBoardId, board?.Id.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }, "remember the open board");
    }
}
