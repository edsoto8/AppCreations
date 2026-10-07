using BoardFlow.Core;
using BoardFlow.Core.Rules;
using BoardFlow.Data;
using BoardFlow.Data.Repositories;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class BoardRepositoryTests
{
    [Fact]
    public void Create_AssignsConsecutiveSortOrdersWithinAWorkspace()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        var first = db.Boards.Create(workspace.Id, "First");
        var second = db.Boards.Create(workspace.Id, "Second");

        Assert.Equal(0, first.SortOrder);
        Assert.Equal(1, second.SortOrder);
        Assert.Equal(["First", "Second"], db.Boards.GetByWorkspace(workspace.Id).Select(b => b.Name));
    }

    [Fact]
    public void Create_SortOrdersAreIndependentPerWorkspace()
    {
        using var db = new TestDatabase();
        var a = db.Workspaces.Create("A");
        var b = db.Workspaces.Create("B");
        db.Boards.Create(a.Id, "A1");
        db.Boards.Create(a.Id, "A2");

        var firstInB = db.Boards.Create(b.Id, "B1");

        Assert.Equal(0, firstInB.SortOrder);
    }

    [Fact]
    public void Create_TrimsNameAndDefaultsDescriptionToEmpty()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        var board = db.Boards.Create(workspace.Id, "  Home  ");

        Assert.Equal("Home", board.Name);
        Assert.Equal("", db.Boards.Get(board.Id)!.Description);
    }

    [Fact]
    public void Create_WithoutDefaultColumns_HasNoColumns()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        var board = db.Boards.Create(workspace.Id, "Plain");

        Assert.Empty(db.Columns.GetByBoard(board.Id));
    }

    [Fact]
    public void Create_WithDefaultColumns_AddsFiveColumnsInOrder()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        var board = db.Boards.Create(workspace.Id, "Project", withDefaultColumns: true);

        var columns = db.Columns.GetByBoard(board.Id);
        Assert.Equal(["Backlog", "Todo", "In Progress", "Review", "Done"], columns.Select(c => c.Name));
        Assert.Equal([0, 1, 2, 3, 4], columns.Select(c => c.SortOrder));
        Assert.Equal(DefaultColumns.Names, columns.Select(c => c.Name));
    }

    [Theory]
    [InlineData("")]
    [InlineData("  ")]
    [InlineData("a\nb")]
    public void Create_InvalidName_ThrowsAndCreatesNothing(string name)
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        Assert.Throws<ValidationException>(() => db.Boards.Create(workspace.Id, name, withDefaultColumns: true));

        Assert.Empty(db.Boards.GetByWorkspace(workspace.Id));
        Assert.Equal(0, db.CountRows("BoardColumns"));
    }

    [Fact]
    public void Create_DescriptionTooLong_Throws()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        Assert.Throws<ValidationException>(() =>
            db.Boards.Create(workspace.Id, "Board", new string('d', Validate.DescriptionMaxLength + 1)));
    }

    [Fact]
    public void Create_InMissingWorkspace_ThrowsNotFound()
    {
        using var db = new TestDatabase();

        Assert.Throws<NotFoundException>(() => db.Boards.Create(999, "Orphan", withDefaultColumns: true));

        Assert.Equal(0, db.CountRows("Boards"));
        Assert.Equal(0, db.CountRows("BoardColumns"));
    }

    [Fact]
    public void Update_ChangesNameAndDescription()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var board = db.Boards.Create(workspace.Id, "Old", "old text");

        db.Boards.Update(board.Id, "  New  ", "new text\n");

        var loaded = db.Boards.Get(board.Id)!;
        Assert.Equal("New", loaded.Name);
        Assert.Equal("new text", loaded.Description);
        Assert.Equal(board.SortOrder, loaded.SortOrder);
        Assert.Equal(board.CreatedAt, loaded.CreatedAt);
        Assert.True(loaded.UpdatedAt > board.UpdatedAt);
    }

    [Fact]
    public void Update_NullDescription_ClearsIt()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var board = db.Boards.Create(workspace.Id, "Board", "text");

        db.Boards.Update(board.Id, "Board", null);

        Assert.Equal("", db.Boards.Get(board.Id)!.Description);
    }

    [Fact]
    public void Update_InvalidName_ThrowsAndKeepsOldValues()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var board = db.Boards.Create(workspace.Id, "Old", "text");

        Assert.Throws<ValidationException>(() => db.Boards.Update(board.Id, "", "changed"));

        var loaded = db.Boards.Get(board.Id)!;
        Assert.Equal("Old", loaded.Name);
        Assert.Equal("text", loaded.Description);
    }

    [Fact]
    public void Update_MissingBoard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Boards.Update(999, "Name", null));
    }

    [Fact]
    public void Delete_RenumbersRemainingBoards()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var a = db.Boards.Create(workspace.Id, "A");
        var b = db.Boards.Create(workspace.Id, "B");
        var c = db.Boards.Create(workspace.Id, "C");

        db.Boards.Delete(b.Id);

        var boards = db.Boards.GetByWorkspace(workspace.Id);
        Assert.Equal([a.Id, c.Id], boards.Select(x => x.Id));
        Assert.Equal([0, 1], boards.Select(x => x.SortOrder));
        Assert.Equal(2, db.Boards.Create(workspace.Id, "D").SortOrder);
    }

    [Fact]
    public void Delete_DoesNotRenumberOtherWorkspaces()
    {
        using var db = new TestDatabase();
        var a = db.Workspaces.Create("A");
        var b = db.Workspaces.Create("B");
        var doomed = db.Boards.Create(a.Id, "doomed");
        db.Boards.Create(b.Id, "B0");
        var b1 = db.Boards.Create(b.Id, "B1");

        db.Boards.Delete(doomed.Id);

        Assert.Equal(1, db.Boards.Get(b1.Id)!.SortOrder);
    }

    [Fact]
    public void Delete_RemovesColumnsAndCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var card = db.AddCard(fixture[0].Id, "Task");

        db.Boards.Delete(fixture.Board.Id);

        Assert.Null(db.Boards.Get(fixture.Board.Id));
        Assert.Empty(db.Columns.GetByBoard(fixture.Board.Id));
        Assert.Null(db.Cards.Get(card.Id));
        Assert.NotNull(db.Workspaces.Get(fixture.Workspace.Id));
    }

    [Fact]
    public void Delete_MissingBoard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Boards.Delete(999));
    }

    [Fact]
    public void Get_ReturnsTheRequestedBoard_AndNullForUnknownIds()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var first = db.Boards.Create(workspace.Id, "First", "one");
        var second = db.Boards.Create(workspace.Id, "Second", "two");

        var loaded = db.Boards.Get(second.Id)!;

        Assert.Equal(second.Id, loaded.Id);
        Assert.Equal("Second", loaded.Name);
        Assert.Equal("two", loaded.Description);
        Assert.Equal(workspace.Id, loaded.WorkspaceId);
        Assert.Equal("First", db.Boards.Get(first.Id)!.Name);
        Assert.Null(db.Boards.Get(424242));
    }

    [Fact]
    public void GetContents_CountsColumnsAndAllCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);
        db.AddCards(fixture[0].Id, "a", "b");
        var archived = db.AddCard(fixture[1].Id, "c");
        db.Cards.SetArchived(archived.Id, true);
        var other = db.AddBoard(fixture.Workspace, "Other", columns: 1);
        db.AddCard(other[0].Id, "elsewhere");

        Assert.Equal(new BoardContents(Columns: 3, Cards: 3), db.Boards.GetContents(fixture.Board.Id));
    }

    [Fact]
    public void Boards_PersistAfterReopen()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var first = db.Boards.Create(workspace.Id, "First", "desc", withDefaultColumns: true);
        var second = db.Boards.Create(workspace.Id, "Second");
        db.Boards.Update(second.Id, "Second renamed", "new desc");

        db.Reopen();

        var boards = db.Boards.GetByWorkspace(workspace.Id);
        Assert.Equal(["First", "Second renamed"], boards.Select(b => b.Name));
        Assert.Equal(["desc", "new desc"], boards.Select(b => b.Description));
        Assert.Equal([0, 1], boards.Select(b => b.SortOrder));
        Assert.Equal(5, db.Columns.GetByBoard(first.Id).Count);
        Assert.Equal(DateTimeKind.Utc, boards[0].CreatedAt.Kind);
    }
}
