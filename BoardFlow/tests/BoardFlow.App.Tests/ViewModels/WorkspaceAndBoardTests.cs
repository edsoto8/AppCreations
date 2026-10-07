using Avalonia.Headless.XUnit;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Tests.App.Support;

namespace BoardFlow.Tests.App.ViewModels;

public sealed class WorkspaceAndBoardTests
{
    [AvaloniaFact]
    public void FirstRun_ShowsWelcomeState()
    {
        using var s = new TestSession();
        s.Main.Initialize();

        Assert.True(s.Main.ShowNoWorkspace);
        Assert.False(s.Main.HasBoard);
        Assert.Empty(s.Main.Workspaces);
    }

    [AvaloniaFact]
    public async Task CreateWorkspaceAndTwoBoards_SwitchingShowsTheRightBoard_AndSurvivesRestart()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s, "Alpha");
        await s.RunWithDialog(() => s.Main.NewBoardCommand.ExecuteAsync(null), d =>
        {
            var board = (BoardDialogViewModel)d;
            board.Name = "Beta";
            board.Description = "Second board";
            board.AddDefaultColumns = false;
            d.Confirm();
        });

        Assert.Equal(["Alpha", "Beta"], s.Main.Boards.Select(b => b.Name));
        Assert.Equal("Beta", s.Board.Name);
        Assert.Empty(s.Board.Columns);

        s.Main.SelectedBoard = s.Main.Boards[0];
        Assert.Equal("Alpha", s.Board.Name);
        Assert.Equal(["Backlog", "Todo", "In Progress", "Review", "Done"], s.Board.Columns.Select(c => c.Name));

        s.Main.SelectedBoard = s.Main.Boards[1];
        s.Restart();
        s.Main.Initialize();

        Assert.Equal("Work", s.Main.SelectedWorkspace!.Name);
        Assert.Equal(["Alpha", "Beta"], s.Main.Boards.Select(b => b.Name));
        Assert.Equal("Beta", s.Board.Name);
        Assert.Equal("Second board", s.Board.Description);
    }

    [AvaloniaFact]
    public async Task RenameWorkspaceAndEditBoard_Persist()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);

        await s.RunWithDialog(() => s.Main.RenameWorkspaceCommand.ExecuteAsync(null), d =>
        {
            ((TextPromptDialogViewModel)d).Text = "  Home  ";
            d.Confirm();
        });
        await s.RunWithDialog(() => s.Main.EditBoardCommand.ExecuteAsync(null), d =>
        {
            var board = (BoardDialogViewModel)d;
            Assert.False(board.IsNew);
            board.Name = "Renovation";
            board.Description = "Kitchen first";
            d.Confirm();
        });

        s.Restart();
        s.Main.Initialize();
        Assert.Equal("Home", s.Main.SelectedWorkspace!.Name);
        Assert.Equal("Renovation", s.Board.Name);
        Assert.Equal("Kitchen first", s.Board.Description);
    }

    [AvaloniaFact]
    public async Task InvalidName_KeepsDialogOpenWithError()
    {
        using var s = new TestSession();
        s.Main.Initialize();

        var task = s.Main.NewWorkspaceCommand.ExecuteAsync(null);
        await TestSession.WaitFor(() => s.Dialog is not null);
        var dialog = (TextPromptDialogViewModel)s.Dialog!;
        dialog.Text = "   ";
        dialog.Confirm();

        Assert.Same(dialog, s.Dialog);
        Assert.Equal("Workspace name is required.", dialog.Error);

        dialog.Cancel();
        await task;
        Assert.Empty(s.Main.Workspaces);
    }

    [AvaloniaFact]
    public async Task DeleteBoard_RequiresConfirmation()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Seed.AddCard(s, 0, "Keep me");

        await s.RunWithDialog(() => s.Main.DeleteBoardCommand.ExecuteAsync(null), d =>
        {
            var confirm = Assert.IsType<ConfirmDialogViewModel>(d);
            Assert.True(confirm.IsDestructive);
            Assert.Contains("1 card", confirm.Message);
            d.Cancel();
        });
        Assert.Single(s.Main.Boards);

        await s.RunWithDialog(() => s.Main.DeleteBoardCommand.ExecuteAsync(null), d => d.Confirm());
        Assert.Empty(s.Main.Boards);
        Assert.True(s.Main.ShowNoBoard);
    }

    [AvaloniaFact]
    public async Task DeleteWorkspace_RequiresConfirmation_ThenRemovesEverything()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);

        await s.RunWithDialog(() => s.Main.DeleteWorkspaceCommand.ExecuteAsync(null), d => d.Cancel());
        Assert.Single(s.Main.Workspaces);

        await s.RunWithDialog(() => s.Main.DeleteWorkspaceCommand.ExecuteAsync(null), d =>
        {
            Assert.Contains("1 board", ((ConfirmDialogViewModel)d).Message);
            d.Confirm();
        });
        Assert.Empty(s.Main.Workspaces);
        Assert.True(s.Main.ShowNoWorkspace);

        s.Restart();
        s.Main.Initialize();
        Assert.Empty(s.Main.Workspaces);
    }
}
