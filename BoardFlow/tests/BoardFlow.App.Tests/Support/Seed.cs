using BoardFlow.Core.Domain;

namespace BoardFlow.Tests.App.Support;

public static class Seed
{
    /// <summary>A workspace with one board ("Launch") using the default columns, opened in the main view model.</summary>
    public static async Task<BoardFlow.App.ViewModels.BoardViewModel> WorkspaceWithBoard(TestSession s, string board = "Launch")
    {
        s.Main.Initialize();
        await s.RunWithDialog(() => s.Main.NewWorkspaceCommand.ExecuteAsync(null), d =>
        {
            ((BoardFlow.App.ViewModels.Dialogs.TextPromptDialogViewModel)d).Text = "Work";
            d.Confirm();
        });
        await s.RunWithDialog(() => s.Main.NewBoardCommand.ExecuteAsync(null), d =>
        {
            ((BoardFlow.App.ViewModels.Dialogs.BoardDialogViewModel)d).Name = board;
            d.Confirm();
        });
        return s.Board;
    }

    public static Card AddCard(TestSession s, int columnIndex, string title, Priority priority = Priority.None)
    {
        var card = s.Cards.Create(s.Board.Columns[columnIndex].Id, new CardInput(title, Priority: priority));
        s.Board.Reload();
        return card;
    }
}
