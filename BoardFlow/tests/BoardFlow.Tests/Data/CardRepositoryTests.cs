using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using BoardFlow.Data;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class CardRepositoryTests
{
    // ---------------------------------------------------------------- create

    [Fact]
    public void Create_AppendsToTheBottomWithDenseSortOrder()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);

        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        var other = db.AddCard(fixture[1].Id, "x");

        Assert.Equal([0, 1, 2], cards.Select(c => c.SortOrder));
        Assert.Equal(0, other.SortOrder);
        Assert.Equal(["a", "b", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Create_ReturnsTheStoredCardWithDefaults()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();

        var card = db.Cards.Create(fixture[0].Id, new CardInput("  Fix sink  "));

        Assert.True(card.Id > 0);
        Assert.Equal("Fix sink", card.Title);
        Assert.Equal("", card.Description);
        Assert.Equal(Priority.None, card.Priority);
        Assert.Null(card.DueDate);
        Assert.False(card.IsArchived);
        Assert.Empty(card.LabelIds);
        Assert.Equal(fixture[0].Id, card.ColumnId);
        Assert.Equal(DateTimeKind.Utc, card.CreatedAt.Kind);
        Assert.Equal(card.CreatedAt, card.UpdatedAt);
    }

    [Fact]
    public void Create_InMissingColumn_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Cards.Create(999, new CardInput("Orphan")));
        Assert.Equal(0, db.CountRows("Cards"));
    }

    [Fact]
    public void EveryField_RoundTripsAfterReopen()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var labelA = db.Labels.Create(fixture.Workspace.Id, "A", "#E5534B");
        var labelB = db.Labels.Create(fixture.Workspace.Id, "B", "#3A7BD5");
        var created = new List<Card>();
        var priorities = Enum.GetValues<Priority>();
        for (var i = 0; i < priorities.Length; i++)
        {
            DateOnly? due = i % 2 == 0 ? new DateOnly(2026, 1, 1).AddDays(i * 40) : null;
            long[] labels = i switch { 0 => [], 1 => [labelA.Id], 2 => [labelB.Id], _ => [labelB.Id, labelA.Id] };
            created.Add(db.Cards.Create(
                fixture[i % 2].Id,
                new CardInput($"Title {i} — ünïcode 日本", $"Line one\nLine two\n\n  indented {i}", priorities[i], due, labels)));
        }

        db.Reopen();

        foreach (var original in created)
        {
            var loaded = db.Cards.Get(original.Id)!;
            Assert.Equal(original.Title, loaded.Title);
            Assert.Equal(original.Description, loaded.Description);
            Assert.Equal(original.Priority, loaded.Priority);
            Assert.Equal(original.DueDate, loaded.DueDate);
            Assert.Equal(original.LabelIds, loaded.LabelIds);
            Assert.Equal(original.ColumnId, loaded.ColumnId);
            Assert.Equal(original.SortOrder, loaded.SortOrder);
            Assert.Equal(original.CreatedAt, loaded.CreatedAt);
            Assert.Equal(original.UpdatedAt, loaded.UpdatedAt);
            Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
            Assert.False(loaded.IsArchived);
        }

        Assert.Equal(priorities, created.Select(c => db.Cards.Get(c.Id)!.Priority));
        Assert.Equal([labelA.Id, labelB.Id], db.Cards.Get(created[^1].Id)!.LabelIds);
        Assert.Null(db.Cards.Get(created[1].Id)!.DueDate);
        Assert.Equal(new DateOnly(2026, 1, 1), db.Cards.Get(created[0].Id)!.DueDate);
    }

    [Fact]
    public void Create_DuplicateLabelIds_AreStoredOnce()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var label = db.Labels.Create(fixture.Workspace.Id, "A", "#E5534B");

        var card = db.Cards.Create(fixture[0].Id, new CardInput("x", LabelIds: [label.Id, label.Id]));

        Assert.Equal([label.Id], card.LabelIds);
    }

    [Fact]
    public void Create_InvalidInput_ThrowsValidationAndWritesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var inputs = new[]
        {
            new CardInput(""),
            new CardInput("   "),
            new CardInput("two\nlines"),
            new CardInput(new string('t', Validate.TitleMaxLength + 1)),
            new CardInput("ok", new string('d', Validate.DescriptionMaxLength + 1)),
            new CardInput("ok", Priority: (Priority)99),
        };

        foreach (var input in inputs)
        {
            Assert.Throws<ValidationException>(() => db.Cards.Create(fixture[0].Id, input));
        }

        Assert.Equal(0, db.CountRows("Cards"));
        Assert.Equal(0, db.CountRows("CardLabels"));
    }

    [Fact]
    public void Create_AcceptsTitleAndDescriptionAtTheirMaximumLength()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();

        var card = db.Cards.Create(
            fixture[0].Id,
            new CardInput(new string('t', Validate.TitleMaxLength), new string('d', Validate.DescriptionMaxLength)));

        var loaded = db.Cards.Get(card.Id)!;
        Assert.Equal(Validate.TitleMaxLength, loaded.Title.Length);
        Assert.Equal(Validate.DescriptionMaxLength, loaded.Description.Length);
    }

    [Fact]
    public void Create_WithLabelFromAnotherWorkspace_IsRejectedAndWritesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var foreign = db.Workspaces.Create("Other");
        var foreignLabel = db.Labels.Create(foreign.Id, "Foreign", "#E5534B");
        var ownLabel = db.Labels.Create(fixture.Workspace.Id, "Own", "#3A7BD5");

        Assert.Throws<ValidationException>(() =>
            db.Cards.Create(fixture[0].Id, new CardInput("x", LabelIds: [ownLabel.Id, foreignLabel.Id])));
        Assert.Throws<ValidationException>(() =>
            db.Cards.Create(fixture[0].Id, new CardInput("x", LabelIds: [424242])));

        Assert.Equal(0, db.CountRows("Cards"));
        Assert.Equal(0, db.CountRows("CardLabels"));
    }

    // ---------------------------------------------------------------- update

    [Fact]
    public void Update_ReplacesAllEditableFields_AndKeepsPlacement()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        db.AddCard(fixture[0].Id, "first");
        var card = db.Cards.Create(fixture[0].Id, new CardInput("old", "old text", Priority.Low, new DateOnly(2026, 5, 1)));

        var updated = db.Cards.Update(card.Id, new CardInput(" new ", "new text", Priority.Critical, null));

        Assert.Equal("new", updated.Title);
        Assert.Equal("new text", updated.Description);
        Assert.Equal(Priority.Critical, updated.Priority);
        Assert.Null(updated.DueDate);
        Assert.Equal(card.ColumnId, updated.ColumnId);
        Assert.Equal(card.SortOrder, updated.SortOrder);
        Assert.Equal(card.CreatedAt, updated.CreatedAt);
        Assert.True(updated.UpdatedAt > card.UpdatedAt);
    }

    [Fact]
    public void Update_ReplacesLabels_AddingAndRemoving()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var a = db.Labels.Create(fixture.Workspace.Id, "A", "#E5534B");
        var b = db.Labels.Create(fixture.Workspace.Id, "B", "#3A7BD5");
        var c = db.Labels.Create(fixture.Workspace.Id, "C", "#4CAF6A");
        var card = db.Cards.Create(fixture[0].Id, new CardInput("x", LabelIds: [a.Id, b.Id]));

        var swapped = db.Cards.Update(card.Id, new CardInput("x", LabelIds: [c.Id, b.Id]));
        Assert.Equal([b.Id, c.Id], swapped.LabelIds);

        var cleared = db.Cards.Update(card.Id, new CardInput("x"));
        Assert.Empty(cleared.LabelIds);

        db.Reopen();
        Assert.Empty(db.Cards.Get(card.Id)!.LabelIds);
        Assert.Equal(0, db.CountRows("CardLabels"));
    }

    [Fact]
    public void Update_BlankTitle_ThrowsAndKeepsEverything()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var label = db.Labels.Create(fixture.Workspace.Id, "A", "#E5534B");
        var card = db.Cards.Create(fixture[0].Id, new CardInput("keep", "text", Priority.High, null, [label.Id]));

        Assert.Throws<ValidationException>(() => db.Cards.Update(card.Id, new CardInput("  ", "changed")));
        Assert.Throws<ValidationException>(() =>
            db.Cards.Update(card.Id, new CardInput(new string('t', Validate.TitleMaxLength + 1), "changed")));

        var loaded = db.Cards.Get(card.Id)!;
        Assert.Equal("keep", loaded.Title);
        Assert.Equal("text", loaded.Description);
        Assert.Equal(Priority.High, loaded.Priority);
        Assert.Equal([label.Id], loaded.LabelIds);
        Assert.Equal(card.UpdatedAt, loaded.UpdatedAt);
    }

    [Fact]
    public void Update_WithLabelFromAnotherWorkspace_IsRejectedAndKeepsOldLabels()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var own = db.Labels.Create(fixture.Workspace.Id, "Own", "#E5534B");
        var foreign = db.Labels.Create(db.Workspaces.Create("Other").Id, "Foreign", "#3A7BD5");
        var card = db.Cards.Create(fixture[0].Id, new CardInput("x", LabelIds: [own.Id]));

        Assert.Throws<ValidationException>(() =>
            db.Cards.Update(card.Id, new CardInput("changed", LabelIds: [foreign.Id])));

        var loaded = db.Cards.Get(card.Id)!;
        Assert.Equal("x", loaded.Title);
        Assert.Equal([own.Id], loaded.LabelIds);
    }

    [Fact]
    public void Update_MissingCard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Cards.Update(999, new CardInput("x")));
    }

    // ---------------------------------------------------------------- delete

    [Fact]
    public void Delete_RenumbersTheRemainingCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c", "d");
        db.AddCards(fixture[1].Id, "x", "y");

        db.Cards.Delete(cards[1].Id);

        Assert.Equal(["a", "c", "d"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["x", "y"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
        Assert.Null(db.Cards.Get(cards[1].Id));
    }

    [Fact]
    public void Delete_RemovesLabelLinksButNotTheLabels()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var label = db.Labels.Create(fixture.Workspace.Id, "A", "#E5534B");
        var card = db.Cards.Create(fixture[0].Id, new CardInput("x", LabelIds: [label.Id]));

        db.Cards.Delete(card.Id);

        Assert.Equal(0, db.CountRows("CardLabels"));
        Assert.Single(db.Labels.GetByWorkspace(fixture.Workspace.Id));
    }

    [Fact]
    public void Delete_ArchivedCard_LeavesActiveOrderUntouched()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.SetArchived(cards[1].Id, true);

        db.Cards.Delete(cards[1].Id);

        Assert.Equal(["a", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
        Assert.Empty(db.Cards.GetArchivedByBoard(fixture.Board.Id));
    }

    [Fact]
    public void Delete_MissingCard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Cards.Delete(999));
    }

    // --------------------------------------------------------------- archive

    [Fact]
    public void Archive_HidesTheCardFromTheDefaultListing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b");

        db.Cards.SetArchived(cards[0].Id, true);

        Assert.Equal(["b"], db.Cards.GetByBoard(fixture.Board.Id).Select(c => c.Title));
        Assert.Equal(["a"], db.Cards.GetArchivedByBoard(fixture.Board.Id).Select(c => c.Title));
        Assert.Equal(
            ["b", "a"],
            db.Cards.GetByBoard(fixture.Board.Id, includeArchived: true).Select(c => c.Title));
        Assert.True(db.Cards.Get(cards[0].Id)!.IsArchived);
    }

    [Fact]
    public void Archive_RenumbersRemainingActiveCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");

        db.Cards.SetArchived(cards[0].Id, true);

        var active = db.Cards.GetByBoard(fixture.Board.Id);
        Assert.Equal(["b", "c"], active.Select(c => c.Title));
        Assert.Equal([0, 1], active.Select(c => c.SortOrder));
    }

    [Fact]
    public void Restore_AppendsToTheBottomOfItsColumn()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.SetArchived(cards[0].Id, true);

        db.Cards.SetArchived(cards[0].Id, false);

        Assert.Equal(["b", "c", "a"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal([0, 1, 2], db.Cards.GetByBoard(fixture.Board.Id).Select(c => c.SortOrder));
        Assert.False(db.Cards.Get(cards[0].Id)!.IsArchived);
        Assert.Empty(db.Cards.GetArchivedByBoard(fixture.Board.Id));
    }

    [Fact]
    public void Archive_Twice_IsANoOp()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.SetArchived(cards[0].Id, true);
        var archivedAt = db.Cards.Get(cards[0].Id)!.UpdatedAt;
        var bUpdatedAt = db.Cards.Get(cards[1].Id)!.UpdatedAt;

        db.Cards.SetArchived(cards[0].Id, true);

        Assert.Equal(archivedAt, db.Cards.Get(cards[0].Id)!.UpdatedAt);
        Assert.Equal(bUpdatedAt, db.Cards.Get(cards[1].Id)!.UpdatedAt);
        Assert.Equal(["b", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Restore_OfAnActiveCard_IsANoOp()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b");

        db.Cards.SetArchived(cards[0].Id, false);

        Assert.Equal(["a", "b"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void GetArchivedByBoard_ListsMostRecentlyArchivedFirst()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var a = db.AddCard(fixture[0].Id, "a");
        var b = db.AddCard(fixture[1].Id, "b");
        var c = db.AddCard(fixture[0].Id, "c");

        db.Cards.SetArchived(b.Id, true);
        db.Cards.SetArchived(a.Id, true);
        db.Cards.SetArchived(c.Id, true);

        Assert.Equal(["c", "a", "b"], db.Cards.GetArchivedByBoard(fixture.Board.Id).Select(x => x.Title));
    }

    [Fact]
    public void Archive_MissingCard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Cards.SetArchived(999, true));
    }

    [Fact]
    public void GetByBoard_OnlyReturnsCardsOfThatBoard_OrderedByColumnThenPosition()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var other = db.AddBoard(fixture.Workspace, "Other", columns: 1);
        db.AddCard(fixture[1].Id, "second-col");
        db.AddCards(fixture[0].Id, "first-a", "first-b");
        db.AddCard(other[0].Id, "elsewhere");
        db.Columns.Move(fixture[1].Id, fixture[0].Id); // second column now leftmost

        var titles = db.Cards.GetByBoard(fixture.Board.Id).Select(c => c.Title);

        Assert.Equal(["second-col", "first-a", "first-b"], titles);
    }

    // ------------------------------------------------------------------ move

    [Fact]
    public void Move_UpWithinColumn()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c", "d");

        db.Cards.Move(cards[3].Id, fixture[0].Id, cards[1].Id);

        Assert.Equal(["a", "d", "b", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_DownWithinColumn()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c", "d");

        db.Cards.Move(cards[0].Id, fixture[0].Id, cards[2].Id);

        Assert.Equal(["b", "a", "c", "d"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_ToEndOfColumn()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");

        db.Cards.Move(cards[0].Id, fixture[0].Id, null);

        Assert.Equal(["b", "c", "a"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_BeforeItself_KeepsPosition()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");

        db.Cards.Move(cards[1].Id, fixture[0].Id, cards[1].Id);

        Assert.Equal(["a", "b", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_AcrossColumns_KeepsBothColumnsDense()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var source = db.AddCards(fixture[0].Id, "a", "b", "c");
        var target = db.AddCards(fixture[1].Id, "x", "y");

        db.Cards.Move(source[1].Id, fixture[1].Id, target[1].Id);

        Assert.Equal(["a", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["x", "b", "y"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        Assert.Equal(fixture[1].Id, db.Cards.Get(source[1].Id)!.ColumnId);
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_AcrossColumns_ToTheEnd()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var source = db.AddCards(fixture[0].Id, "a", "b");
        db.AddCards(fixture[1].Id, "x", "y");

        db.Cards.Move(source[0].Id, fixture[1].Id, null);

        Assert.Equal(["b"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["x", "y", "a"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_IntoAnEmptyColumn_AndEmptyingTheSource()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var only = db.AddCard(fixture[0].Id, "only");

        db.Cards.Move(only.Id, fixture[1].Id, null);

        Assert.Empty(db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["only"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        Assert.Equal(0, db.Cards.Get(only.Id)!.SortOrder);
    }

    [Fact]
    public void Move_ToAColumnOnAnotherBoard_ThrowsValidationAndChangesNothing()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var other = db.AddBoard(fixture.Workspace, "Other", columns: 1);
        var cards = db.AddCards(fixture[0].Id, "a", "b");
        db.AddCard(other[0].Id, "x");

        Assert.Throws<ValidationException>(() => db.Cards.Move(cards[0].Id, other[0].Id, null));

        Assert.Equal(["a", "b"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["x"], db.ActiveTitles(other.Board.Id, other[0].Id));
        Assert.Equal(fixture[0].Id, db.Cards.Get(cards[0].Id)!.ColumnId);
    }

    [Fact]
    public void Move_ArchivedCard_ThrowsValidation()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var cards = db.AddCards(fixture[0].Id, "a", "b");
        db.Cards.SetArchived(cards[0].Id, true);

        var ex = Assert.Throws<ValidationException>(() => db.Cards.Move(cards[0].Id, fixture[1].Id, null));

        Assert.Contains("Archived", ex.Message);
        Assert.Equal(fixture[0].Id, db.Cards.Get(cards[0].Id)!.ColumnId);
        Assert.True(db.Cards.Get(cards[0].Id)!.IsArchived);
    }

    [Fact]
    public void Move_WithAnArchivedAnchor_FallsBackToTheBottom()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var moving = db.AddCard(fixture[0].Id, "moving");
        var target = db.AddCards(fixture[1].Id, "x", "y", "z");
        db.Cards.SetArchived(target[1].Id, true);

        db.Cards.Move(moving.Id, fixture[1].Id, target[1].Id);

        Assert.Equal(["x", "z", "moving"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_WithAnAnchorFromAnotherColumn_FallsBackToTheBottom()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);
        var moving = db.AddCards(fixture[0].Id, "a", "b");
        db.AddCards(fixture[1].Id, "x", "y");
        var stale = db.AddCard(fixture[2].Id, "stale");

        db.Cards.Move(moving[0].Id, fixture[1].Id, stale.Id);

        Assert.Equal(["x", "y", "a"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        Assert.Equal(["b"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["stale"], db.ActiveTitles(fixture.Board.Id, fixture[2].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Move_WithAnAnchorThatWasDeleted_FallsBackToTheBottom()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.Delete(cards[2].Id);

        db.Cards.Move(cards[0].Id, fixture[0].Id, cards[2].Id);

        Assert.Equal(["b", "a"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
    }

    [Fact]
    public void Move_MissingCardOrColumn_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var card = db.AddCard(fixture[0].Id, "a");

        Assert.Throws<NotFoundException>(() => db.Cards.Move(999, fixture[0].Id, null));
        Assert.Throws<NotFoundException>(() => db.Cards.Move(card.Id, 999, null));
        Assert.Equal(["a"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
    }

    [Fact]
    public void Move_DoesNotTouchArchivedCardsInTheTargetColumn()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var archived = db.AddCard(fixture[1].Id, "archived");
        db.Cards.SetArchived(archived.Id, true);
        var moving = db.AddCard(fixture[0].Id, "moving");

        db.Cards.Move(moving.Id, fixture[1].Id, null);

        Assert.Equal(["moving"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        Assert.Equal(0, db.Cards.Get(moving.Id)!.SortOrder);
        Assert.True(db.Cards.Get(archived.Id)!.IsArchived);
        Assert.Equal(fixture[1].Id, db.Cards.Get(archived.Id)!.ColumnId);
    }

    [Fact]
    public void Move_PersistsAfterReopen()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.Cards.Move(cards[2].Id, fixture[1].Id, null);
        db.Cards.Move(cards[0].Id, fixture[0].Id, null);

        db.Reopen();

        Assert.Equal(["b", "a"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(["c"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void RandomMoves_Across3Columns_NeverLoseDuplicateOrGapCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 3);
        var random = new Random(20260310);

        // An independent model of what each column should contain after every move.
        var model = fixture.Columns.ToDictionary(c => c.Id, _ => new List<long>());
        var allIds = new List<long>();
        for (var i = 0; i < 15; i++)
        {
            var column = fixture[i % 3];
            var card = db.AddCard(column.Id, $"card {i}");
            model[column.Id].Add(card.Id);
            allIds.Add(card.Id);
        }

        for (var step = 1; step <= 500; step++)
        {
            var id = allIds[random.Next(allIds.Count)];
            var targetColumn = fixture[random.Next(3)].Id;
            long? anchor = null;
            if (random.Next(4) != 0)
            {
                // Any other card: sometimes in the target column, sometimes a stale anchor from elsewhere.
                do
                {
                    anchor = allIds[random.Next(allIds.Count)];
                }
                while (anchor == id);
            }

            db.Cards.Move(id, targetColumn, anchor);

            foreach (var list in model.Values)
            {
                list.Remove(id);
            }

            var targetList = model[targetColumn];
            var anchorIndex = anchor is { } a ? targetList.IndexOf(a) : -1;
            if (anchorIndex >= 0)
            {
                targetList.Insert(anchorIndex, id);
            }
            else
            {
                targetList.Add(id);
            }

            if (step % 25 == 0 || step == 500)
            {
                AssertBoardMatchesModel(db, fixture, model, expectedTotal: 15);
            }
        }

        db.Reopen();
        AssertBoardMatchesModel(db, fixture, model, expectedTotal: 15);
    }

    private static void AssertBoardMatchesModel(
        TestDatabase db, BoardFixture fixture, Dictionary<long, List<long>> model, int expectedTotal)
    {
        var cards = db.Cards.GetByBoard(fixture.Board.Id, includeArchived: true);
        Assert.Equal(expectedTotal, cards.Count);
        Assert.Equal(expectedTotal, cards.Select(c => c.Id).Distinct().Count());
        Assert.Equal(expectedTotal, db.CountRows("Cards"));

        foreach (var column in fixture.Columns)
        {
            var inColumn = cards.Where(c => c.ColumnId == column.Id).OrderBy(c => c.SortOrder).ToList();
            Assert.Equal(Enumerable.Range(0, inColumn.Count), inColumn.Select(c => c.SortOrder));
            Assert.Equal(model[column.Id], inColumn.Select(c => c.Id));
        }
    }

    // ------------------------------------------------------------- duplicate

    [Fact]
    public void Duplicate_CreatesADistinctCardDirectlyBelowTheOriginal()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard(columns: 2);
        var cards = db.AddCards(fixture[0].Id, "a", "b", "c");
        db.AddCard(fixture[1].Id, "x");

        var copy = db.Cards.Duplicate(cards[0].Id);

        Assert.NotEqual(cards[0].Id, copy.Id);
        Assert.Equal("a (copy)", copy.Title);
        Assert.Equal(["a", "a (copy)", "b", "c"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(1, copy.SortOrder);
        Assert.Equal(["x"], db.ActiveTitles(fixture.Board.Id, fixture[1].Id));
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Duplicate_OfTheLastCard_GoesToTheBottom()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b");

        var copy = db.Cards.Duplicate(cards[1].Id);

        Assert.Equal(["a", "b", "b (copy)"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.Equal(2, copy.SortOrder);
    }

    [Fact]
    public void Duplicate_CopiesFieldsAndLabels_AndPersistsAfterReopen()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var a = db.Labels.Create(fixture.Workspace.Id, "A", "#E5534B");
        var b = db.Labels.Create(fixture.Workspace.Id, "B", "#3A7BD5");
        var original = db.Cards.Create(
            fixture[0].Id,
            new CardInput("Plan trip", "Book hotel\nBuy tickets", Priority.High, new DateOnly(2026, 8, 1), [a.Id, b.Id]));

        var copy = db.Cards.Duplicate(original.Id);
        db.Reopen();

        var loaded = db.Cards.Get(copy.Id)!;
        Assert.Equal("Plan trip (copy)", loaded.Title);
        Assert.Equal("Book hotel\nBuy tickets", loaded.Description);
        Assert.Equal(Priority.High, loaded.Priority);
        Assert.Equal(new DateOnly(2026, 8, 1), loaded.DueDate);
        Assert.Equal([a.Id, b.Id], loaded.LabelIds);
        Assert.Equal(original.ColumnId, loaded.ColumnId);
        Assert.False(loaded.IsArchived);
        Assert.True(loaded.CreatedAt > original.CreatedAt);

        // The original is unchanged and still carries its labels.
        var reloadedOriginal = db.Cards.Get(original.Id)!;
        Assert.Equal("Plan trip", reloadedOriginal.Title);
        Assert.Equal([a.Id, b.Id], reloadedOriginal.LabelIds);
        Assert.Equal(2, db.Labels.CountUsage(a.Id));
    }

    [Fact]
    public void Duplicate_OfA200CharacterTitle_StaysWithinTheTitleLimit()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var original = db.Cards.Create(fixture[0].Id, new CardInput(new string('x', Validate.TitleMaxLength)));

        var copy = db.Cards.Duplicate(original.Id);

        Assert.True(copy.Title.Length <= Validate.TitleMaxLength);
        Assert.EndsWith(" (copy)", copy.Title);
        Assert.StartsWith("xxxxxxxx", copy.Title);
        Assert.Equal(copy.Title, Validate.CardTitle(copy.Title));
        Assert.Equal(copy.Title, db.Cards.Get(copy.Id)!.Title);

        // The copy can itself be edited (revalidated) and duplicated again.
        db.Cards.Update(copy.Id, new CardInput(copy.Title));
        var second = db.Cards.Duplicate(copy.Id);
        Assert.True(second.Title.Length <= Validate.TitleMaxLength);
    }

    [Fact]
    public void Duplicate_OfAnArchivedCard_CreatesAnActiveCopyAtTheBottom()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var cards = db.AddCards(fixture[0].Id, "a", "b");
        db.Cards.SetArchived(cards[0].Id, true);

        var copy = db.Cards.Duplicate(cards[0].Id);

        Assert.False(copy.IsArchived);
        Assert.Equal(["b", "a (copy)"], db.ActiveTitles(fixture.Board.Id, fixture[0].Id));
        Assert.True(db.Cards.Get(cards[0].Id)!.IsArchived);
        db.AssertDenseOrder(fixture.Board.Id);
    }

    [Fact]
    public void Duplicate_MissingCard_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Cards.Duplicate(999));
    }
}
