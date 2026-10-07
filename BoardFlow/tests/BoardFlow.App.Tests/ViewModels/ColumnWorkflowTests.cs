using Avalonia.Headless.XUnit;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Data.Repositories;
using BoardFlow.Tests.App.Support;

namespace BoardFlow.Tests.App.ViewModels;

public sealed class ColumnWorkflowTests
{
    [AvaloniaFact]
    public async Task AddRenameAndReorderColumns_SurviveRestart()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        await s.RunWithDialog(() => s.Board.AddColumnCommand.ExecuteAsync(null), d =>
        {
            ((TextPromptDialogViewModel)d).Text = "Blocked";
            d.Confirm();
        });
        await s.RunWithDialog(() => s.Board.RenameColumnCommand.ExecuteAsync(s.Board.Columns[1]), d =>
        {
            ((TextPromptDialogViewModel)d).Text = "Next up";
            d.Confirm();
        });
        s.Board.MoveColumnLeftCommand.Execute(s.Board.Columns[5]);
        s.Board.MoveColumnRightCommand.Execute(s.Board.Columns[0]);

        string[] expected = ["Next up", "Backlog", "In Progress", "Review", "Blocked", "Done"];
        Assert.Equal(expected, s.Board.Columns.Select(c => c.Name));
        Assert.True(s.Board.Columns[0].IsFirst);
        Assert.True(s.Board.Columns[5].IsLast);

        s.Restart();
        s.Main.Initialize();
        Assert.Equal(expected, s.Board.Columns.Select(c => c.Name));
    }

    [AvaloniaFact]
    public async Task DeleteEmptyColumn_AsksOnce()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        await s.RunWithDialog(() => s.Board.DeleteColumnCommand.ExecuteAsync(s.Board.Columns[3]), d =>
        {
            Assert.False(((DeleteColumnDialogViewModel)d).HasCards);
            d.Confirm();
        });

        Assert.Equal(["Backlog", "Todo", "In Progress", "Done"], s.Board.Columns.Select(c => c.Name));
    }

    [AvaloniaFact]
    public async Task DeleteNonEmptyColumn_DefaultsToMovingCards()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Seed.AddCard(s, 1, "Rescued");
        var archived = Seed.AddCard(s, 1, "Archived");
        s.Cards.SetArchived(archived.Id, true);
        Seed.AddCard(s, 2, "Already here");

        await s.RunWithDialog(() => s.Board.DeleteColumnCommand.ExecuteAsync(s.Board.Columns[1]), d =>
        {
            var dialog = (DeleteColumnDialogViewModel)d;
            Assert.Contains("1 card and 1 archived card", dialog.Message);
            Assert.True(dialog.MoveCards);
            dialog.SelectedTarget = dialog.OtherColumns.Single(c => c.Name == "In Progress");
            d.Confirm();
        });

        var inProgress = s.Board.Columns.Single(c => c.Name == "In Progress");
        Assert.Equal(["Already here", "Rescued"], inProgress.Cards.Select(c => c.Title));
        Assert.Equal(inProgress.Id, s.Cards.Get(archived.Id)!.ColumnId);
    }

    [AvaloniaFact]
    public async Task DeleteNonEmptyColumn_WithCards_OnlyWhenExplicitlyChosen()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Doomed");

        await s.RunWithDialog(() => s.Board.DeleteColumnCommand.ExecuteAsync(s.Board.Columns[0]), d => d.Cancel());
        Assert.NotNull(s.Cards.Get(card.Id));

        await s.RunWithDialog(() => s.Board.DeleteColumnCommand.ExecuteAsync(s.Board.Columns[0]), d =>
        {
            var dialog = (DeleteColumnDialogViewModel)d;
            dialog.MoveCards = false;
            dialog.DeleteCards = true;
            Assert.Equal("Delete column and cards", dialog.ConfirmText);
            d.Confirm();
        });
        Assert.Null(s.Cards.Get(card.Id));
        Assert.Equal(4, s.Board.Columns.Count);
    }

    [AvaloniaFact]
    public async Task BoardWithoutColumns_OffersDefaults_QuickAddExplainsWhy()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        foreach (var column in s.Board.Columns.ToList())
        {
            s.Columns.Delete(column.Id, ColumnCardHandling.RefuseIfNotEmpty);
        }

        s.Board.Reload();
        Assert.False(s.Board.HasColumns);
        Assert.False(s.Board.BeginQuickAdd());
        Assert.Contains("Add a column first", s.Main.Notifier.Message);

        s.Board.AddDefaultColumnsCommand.Execute(null);
        Assert.Equal(5, s.Board.Columns.Count);
    }
}
