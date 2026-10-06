using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Data;
using BoardFlow.Data.Repositories;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class ColumnRepositoryTests
{
    private static List<string> Names(TestDatabase db, long boardId) =>
        db.Columns.GetByBoard(boardId).Select(c => c.Name).ToList();

    private static void AssertDenseColumns(TestDatabase db, long boardId) =>
        Assert.Equal(
            Enumerable.Range(0, db.Columns.GetByBoard(boardId).Count),
            db.Columns.GetByBoard(boardId).Select(c => c.SortOrder));

    /// <summary>Everything that identifies where cards and columns sit, to prove a failed operation changed nothing.</summary>
    private static string Snapshot(TestDatabase db, long boardId)
    {
        var columns = db.Columns.GetByBoard(boardId).Select(c => $"col {c.Id}:{c.Name}@{c.SortOrder}");
        var cards = db.Cards.GetByBoard(boardId, includeArchived: true)
            .OrderBy(c => c.Id)
            .Select(c => $"card {c.Id}:{c.Title} col={c.ColumnId} order={c.SortOrder} archived={c.IsArchived} upd={c.UpdatedAt:O}");
        return string.Join("\n", columns.Concat(cards));
    }

    [Fact]
    public void Create_AppendsAtTheRightHandEnd()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var board = db.Boards.Create(workspace.Id, "Board");

        var first = db.Columns.Create(board.Id, " First ");
        var second = db.Columns.Create(board.Id, "Second");

        Assert.Equal("First", first.Name);
        Assert.Equal(0, first.SortOrder);
        Assert.Equal(1, second.SortOrder);
        Assert.Equal(["First", "Second"], Names(db, board.Id));
    }

    [Fact]
    public void Create_InvalidName_ThrowsAndWritesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 1);

        Assert.Throws<ValidationException>(() => db.Columns.Create(fixture.Board.Id, "  "));

        Assert.Single(db.Columns.GetByBoard(fixture.Board.Id));
    }

    [Fact]
    public void Create_OnMissingBoard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Columns.Create(999, "Orphan"));
    }

    [Fact]
    public void AddDefaultColumns_AppendsAfterExistingColumns()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);

        var all = db.Columns.AddDefaultColumns(fixture.Board.Id);

        Assert.Equal(["Todo", "Doing", "Backlog", "Todo", "In Progress", "Review", "Done"], all.Select(c => c.Name));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void Rename_ChangesNameOnly()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();

        db.Columns.Rename(fixture[1].Id, " Renamed ");

        var loaded = db.Columns.Get(fixture[1].Id)!;
        Assert.Equal("Renamed", loaded.Name);
        Assert.Equal(1, loaded.SortOrder);
        Assert.Equal(fixture.Board.Id, loaded.BoardId);
    }

    [Fact]
    public void Rename_InvalidOrMissing_Throws()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();

        Assert.Throws<ValidationException>(() => db.Columns.Rename(fixture[0].Id, ""));
        Assert.Throws<NotFoundException>(() => db.Columns.Rename(999, "Name"));
        Assert.Equal("Todo", db.Columns.Get(fixture[0].Id)!.Name);
    }

    [Fact]
    public void Move_BeforeAnotherColumn_Backward()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 4);

        db.Columns.Move(fixture[3].Id, fixture[1].Id);

        Assert.Equal(["Todo", "Done", "Doing", "Review"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void Move_BeforeAnotherColumn_Forward()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 4);

        db.Columns.Move(fixture[0].Id, fixture[3].Id);

        Assert.Equal(["Doing", "Review", "Todo", "Done"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void Move_ToEnd_WhenBeforeIsNull()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 4);

        db.Columns.Move(fixture[0].Id, null);

        Assert.Equal(["Doing", "Review", "Done", "Todo"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void Move_WithAnchorFromAnotherBoard_ThrowsValidationAndChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);
        var other = db.AddBoard(fixture.Workspace, "Other", columns: 2);
        var before = Snapshot(db, fixture.Board.Id);

        Assert.Throws<ValidationException>(() => db.Columns.Move(fixture[0].Id, other[1].Id));

        Assert.Equal(before, Snapshot(db, fixture.Board.Id));
        Assert.Equal(["Todo", "Doing"], Names(db, other.Board.Id));
    }

    [Fact]
    public void Move_MissingColumn_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Columns.Move(999, null));
        Assert.Throws<NotFoundException>(() => db.Columns.MoveBy(999, 1));
    }

    [Fact]
    public void MoveBy_MovesRightAndLeft()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 4);

        db.Columns.MoveBy(fixture[0].Id, 2);
        Assert.Equal(["Doing", "Review", "Todo", "Done"], Names(db, fixture.Board.Id));

        db.Columns.MoveBy(fixture[3].Id, -1);
        Assert.Equal(["Doing", "Review", "Done", "Todo"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void MoveBy_ClampsAtBothEnds()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);

        db.Columns.MoveBy(fixture[0].Id, -5);
        Assert.Equal(["Todo", "Doing", "Review"], Names(db, fixture.Board.Id));

        db.Columns.MoveBy(fixture[1].Id, 50);
        Assert.Equal(["Todo", "Review", "Doing"], Names(db, fixture.Board.Id));

        db.Columns.MoveBy(fixture[2].Id, -50);
        Assert.Equal(["Review", "Todo", "Doing"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void MoveBy_ZeroOffset_ChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);

        db.Columns.MoveBy(fixture[1].Id, 0);

        Assert.Equal(["Todo", "Doing", "Review"], Names(db, fixture.Board.Id));
    }

    [Fact]
    public void Move_DoesNotAffectOtherBoards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);
        var other = db.AddBoard(fixture.Workspace, "Other", columns: 3);

        db.Columns.Move(fixture[2].Id, fixture[0].Id);

        Assert.Equal(["Todo", "Doing", "Review"], Names(db, other.Board.Id));
        AssertDenseColumns(db, other.Board.Id);
    }

    [Fact]
    public void ColumnOrder_SurvivesReopen()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 4);
        db.Columns.Move(fixture[3].Id, fixture[0].Id);
        db.Columns.MoveBy(fixture[1].Id, 1);

        db.Reopen();

        Assert.Equal(["Done", "Todo", "Review", "Doing"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void Delete_EmptyColumn_RenumbersTheRest()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 4);

        db.Columns.Delete(fixture[1].Id);

        Assert.Null(db.Columns.Get(fixture[1].Id));
        Assert.Equal(["Todo", "Review", "Done"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void Delete_MissingColumn_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Columns.Delete(999));
    }

    [Fact]
    public void Delete_NonEmptyColumn_WithDefaultHandling_ThrowsAndDeletesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        db.AddCards(fixture[0].Id, "a", "b");
        var archived = db.AddCard(fixture[0].Id, "c");
        db.Cards.SetArchived(archived.Id, true);
        var before = Snapshot(db, fixture.Board.Id);

        var ex = Assert.Throws<ValidationException>(() => db.Columns.Delete(fixture[0].Id));

        Assert.Contains("3 card(s)", ex.Message);
        Assert.Equal(before, Snapshot(db, fixture.Board.Id));
    }

    [Fact]
    public void Delete_ColumnHoldingOnlyArchivedCards_IsStillRefused()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var card = db.AddCard(fixture[0].Id, "hidden");
        db.Cards.SetArchived(card.Id, true);

        Assert.Throws<ValidationException>(() => db.Columns.Delete(fixture[0].Id));

        Assert.NotNull(db.Columns.Get(fixture[0].Id));
        Assert.NotNull(db.Cards.Get(card.Id));
    }

    [Fact]
    public void Delete_MoveToColumn_MovesAllCardsIncludingArchivedAndAppendsAfterTargetCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);
        var target = fixture[2];
        db.AddCards(target.Id, "t1", "t2");
        var source = db.AddCards(fixture[0].Id, "s1", "s2", "s3", "s4");
        db.Cards.SetArchived(source[1].Id, true); // s2 archived: s1, s3, s4 active
        db.Cards.SetArchived(source[3].Id, true); // s4 archived: s1, s3 active
        db.AddCard(fixture[1].Id, "untouched");

        db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, target.Id);

        Assert.Null(db.Columns.Get(fixture[0].Id));
        Assert.Equal(["t1", "t2", "s1", "s3"], db.ActiveTitles(fixture.Board.Id, target.Id));
        db.AssertDenseOrder(fixture.Board.Id);
        Assert.Equal(new ColumnCardCount(Active: 4, Archived: 2), db.Columns.CountCards(target.Id));

        // Archived cards moved too and stay archived.
        var archived = db.Cards.GetArchivedByBoard(fixture.Board.Id);
        Assert.Equal(["s2", "s4"], archived.Select(c => c.Title).Order());
        Assert.All(archived, c => Assert.Equal(target.Id, c.ColumnId));

        // Other columns are untouched and renumbered.
        Assert.Equal(["untouched"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        Assert.Equal(["Doing", "Review"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
        Assert.Equal(7, db.CountRows("Cards"));
    }

    [Fact]
    public void Delete_MoveToColumn_RestoredArchivedCardLandsAtTheBottomOfTheTarget()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        db.AddCard(fixture[1].Id, "t1");
        var s1 = db.AddCard(fixture[0].Id, "s1");
        db.Cards.SetArchived(s1.Id, true);

        db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, fixture[1].Id);
        db.Cards.SetArchived(s1.Id, false);

        Assert.Equal(["t1", "s1"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Delete_MoveToColumn_IntoAnEmptyTarget_KeepsRelativeOrder()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.Move(cards[2].Id, fixture[0].Id, cards[0].Id); // c, a, b

        db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, fixture[1].Id);

        Assert.Equal(["c", "a", "b"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Delete_MoveToColumn_WithoutTarget_ThrowsAndChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        db.AddCards(fixture[0].Id, "a", "b");
        var before = Snapshot(db, fixture.Board.Id);

        Assert.Throws<ValidationException>(() =>
            db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, null));

        Assert.Equal(before, Snapshot(db, fixture.Board.Id));
    }

    [Fact]
    public void Delete_MoveToColumn_ToItself_ThrowsAndChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        db.AddCards(fixture[0].Id, "a", "b");
        var before = Snapshot(db, fixture.Board.Id);

        Assert.Throws<ValidationException>(() =>
            db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, fixture[0].Id));

        Assert.Equal(before, Snapshot(db, fixture.Board.Id));
    }

    [Fact]
    public void Delete_MoveToColumn_ToAnotherBoardsColumn_ThrowsAndChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var other = db.AddBoard(fixture.Workspace, "Other", columns: 1);
        db.AddCards(fixture[0].Id, "a", "b");
        var before = Snapshot(db, fixture.Board.Id);
        var otherBefore = Snapshot(db, other.Board.Id);

        Assert.Throws<ValidationException>(() =>
            db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, other[0].Id));

        Assert.Equal(before, Snapshot(db, fixture.Board.Id));
        Assert.Equal(otherBefore, Snapshot(db, other.Board.Id));
    }

    [Fact]
    public void Delete_MoveToColumn_ToAMissingColumn_ThrowsAndChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        db.AddCards(fixture[0].Id, "a");
        var before = Snapshot(db, fixture.Board.Id);

        Assert.Throws<ValidationException>(() =>
            db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, 99999));

        Assert.Equal(before, Snapshot(db, fixture.Board.Id));
    }

    [Fact]
    public void Delete_MoveToColumn_OnAnEmptyColumn_NeedsNoTarget()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);

        db.Columns.Delete(fixture[0].Id, ColumnCardHandling.MoveToColumn, null);

        Assert.Equal(["Doing"], Names(db, fixture.Board.Id));
    }

    [Fact]
    public void Delete_DeleteCards_RemovesCardsAndTheirLabelLinks()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var label = db.Labels.Create(fixture.Workspace.Id, "Bug", "#E5534B");
        var doomed = db.Cards.Create(fixture[0].Id, new CardInput("doomed", LabelIds: [label.Id]));
        var archived = db.Cards.Create(fixture[0].Id, new CardInput("doomed archived", LabelIds: [label.Id]));
        db.Cards.SetArchived(archived.Id, true);
        var kept = db.Cards.Create(fixture[1].Id, new CardInput("kept", LabelIds: [label.Id]));
        Assert.Equal(3, db.CountRows("CardLabels"));

        db.Columns.Delete(fixture[0].Id, ColumnCardHandling.DeleteCards);

        Assert.Null(db.Columns.Get(fixture[0].Id));
        Assert.Null(db.Cards.Get(doomed.Id));
        Assert.Null(db.Cards.Get(archived.Id));
        Assert.NotNull(db.Cards.Get(kept.Id));
        Assert.Equal(1, db.CountRows("CardLabels"));
        Assert.Equal(1, db.CountRows("Cards"));
        Assert.Equal(1, db.Labels.CountUsage(label.Id));
        Assert.Single(db.Labels.GetByWorkspace(fixture.Workspace.Id));
        Assert.Equal(["Doing"], Names(db, fixture.Board.Id));
        AssertDenseColumns(db, fixture.Board.Id);
    }

    [Fact]
    public void CountCards_SeparatesActiveFromArchived()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.SetArchived(cards[0].Id, true);
        db.AddCard(fixture[1].Id, "other column");

        var count = db.Columns.CountCards(fixture[0].Id);

        Assert.Equal(new ColumnCardCount(2, 1), count);
        Assert.Equal(3, count.Total);
    }

    [Fact]
    public void CountCards_EmptyColumn_IsZero()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 1);
        Assert.Equal(new ColumnCardCount(0, 0), db.Columns.CountCards(fixture[0].Id));
    }
}
