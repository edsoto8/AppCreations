using BoardFlow.Core.Domain;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class SmokeTests
{
    [Fact]
    public void FullHierarchy_RoundTripsAcrossRestart()
    {
        using var db = new TestDatabase();
        var ws = db.Workspaces.Create("Personal");
        var board = db.Boards.Create(ws.Id, "Home", "Chores", withDefaultColumns: true);
        var columns = db.Columns.GetByBoard(board.Id);
        var label = db.Labels.Create(ws.Id, "Urgent", "#e5534b");
        var card = db.Cards.Create(columns[1].Id, new CardInput("Fix sink", "Kitchen", Priority.High, new DateOnly(2026, 3, 12), [label.Id]));

        db.Reopen();

        var loaded = db.Cards.Get(card.Id)!;
        Assert.Equal("Fix sink", loaded.Title);
        Assert.Equal("Kitchen", loaded.Description);
        Assert.Equal(Priority.High, loaded.Priority);
        Assert.Equal(new DateOnly(2026, 3, 12), loaded.DueDate);
        Assert.Equal([label.Id], loaded.LabelIds);
        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(card.CreatedAt, loaded.CreatedAt);
        Assert.Equal(5, db.Columns.GetByBoard(board.Id).Count);
        Assert.Equal(new BoardFlow.Data.Repositories.ColumnCardCount(1, 0), db.Columns.CountCards(columns[1].Id));
        Assert.Equal("#E5534B", db.Labels.GetByWorkspace(ws.Id).Single().DisplayColor);
    }
}
