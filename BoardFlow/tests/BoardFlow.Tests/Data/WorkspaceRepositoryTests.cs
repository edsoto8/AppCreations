using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using BoardFlow.Data;
using BoardFlow.Data.Repositories;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class WorkspaceRepositoryTests
{
    [Fact]
    public void Create_TrimsNameAndStoresUtcTimestamps()
    {
        using var db = new TestDatabase();

        var workspace = db.Workspaces.Create("  Personal  ");

        Assert.True(workspace.Id > 0);
        Assert.Equal("Personal", workspace.Name);
        var loaded = db.Workspaces.Get(workspace.Id)!;
        Assert.Equal("Personal", loaded.Name);
        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
        Assert.Equal(workspace.CreatedAt, loaded.CreatedAt);
        Assert.Equal(loaded.CreatedAt, loaded.UpdatedAt);
    }

    [Fact]
    public void Get_UnknownId_ReturnsNull()
    {
        using var db = new TestDatabase();
        Assert.Null(db.Workspaces.Get(12345));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("two\nlines")]
    public void Create_InvalidName_ThrowsAndWritesNothing(string name)
    {
        using var db = new TestDatabase();

        Assert.Throws<ValidationException>(() => db.Workspaces.Create(name));

        Assert.Empty(db.Workspaces.GetAll());
    }

    [Fact]
    public void Create_NameTooLong_Throws()
    {
        using var db = new TestDatabase();
        Assert.Throws<ValidationException>(() => db.Workspaces.Create(new string('w', Validate.NameMaxLength + 1)));
        Assert.Equal(Validate.NameMaxLength, db.Workspaces.Create(new string('w', Validate.NameMaxLength)).Name.Length);
    }

    [Fact]
    public void Rename_ChangesNameAndUpdatedAtOnly()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Old");

        db.Workspaces.Rename(workspace.Id, " New ");

        var loaded = db.Workspaces.Get(workspace.Id)!;
        Assert.Equal("New", loaded.Name);
        Assert.Equal(workspace.CreatedAt, loaded.CreatedAt);
        Assert.True(loaded.UpdatedAt > loaded.CreatedAt);
    }

    [Fact]
    public void Rename_InvalidName_ThrowsAndKeepsOldName()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Old");

        Assert.Throws<ValidationException>(() => db.Workspaces.Rename(workspace.Id, "  "));

        Assert.Equal("Old", db.Workspaces.Get(workspace.Id)!.Name);
    }

    [Fact]
    public void Rename_MissingWorkspace_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Workspaces.Rename(999, "Anything"));
    }

    [Fact]
    public void Delete_MissingWorkspace_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Workspaces.Delete(999));
    }

    [Fact]
    public void GetAll_OrdersByNameIgnoringCase()
    {
        using var db = new TestDatabase();
        db.Workspaces.Create("charlie");
        db.Workspaces.Create("Bravo");
        db.Workspaces.Create("alpha");

        Assert.Equal(["alpha", "Bravo", "charlie"], db.Workspaces.GetAll().Select(w => w.Name));
    }

    [Fact]
    public void GetAll_SameNameKeepsCreationOrder()
    {
        using var db = new TestDatabase();
        var first = db.Workspaces.Create("Same");
        var second = db.Workspaces.Create("Same");

        Assert.Equal([first.Id, second.Id], db.Workspaces.GetAll().Select(w => w.Id));
    }

    [Fact]
    public void Delete_RemovesOnlyThatWorkspace()
    {
        using var db = new TestDatabase();
        var keep = db.Workspaces.Create("Keep");
        var drop = db.Workspaces.Create("Drop");

        db.Workspaces.Delete(drop.Id);

        Assert.Equal([keep.Id], db.Workspaces.GetAll().Select(w => w.Id));
        Assert.Null(db.Workspaces.Get(drop.Id));
    }

    [Fact]
    public void Delete_CascadesToBoardsColumnsCardsAndLabels_WithoutTouchingOtherWorkspaces()
    {
        using var db = new TestDatabase();
        var doomed = db.CreateBoard(columns: 2, workspaceName: "Doomed");
        var doomedLabel = db.Labels.Create(doomed.Workspace.Id, "Bug", "#E5534B");
        var doomedCard = db.Cards.Create(doomed[0].Id, new CardInput("Gone", LabelIds: [doomedLabel.Id]));
        var archived = db.AddCard(doomed[1].Id, "Gone too");
        db.Cards.SetArchived(archived.Id, true);

        var survivor = db.CreateBoard(columns: 2, workspaceName: "Survivor");
        var survivorLabel = db.Labels.Create(survivor.Workspace.Id, "Bug", "#E5534B");
        var survivorCard = db.Cards.Create(survivor[0].Id, new CardInput("Stays", LabelIds: [survivorLabel.Id]));

        db.Workspaces.Delete(doomed.Workspace.Id);

        Assert.Empty(db.Boards.GetByWorkspace(doomed.Workspace.Id));
        Assert.Null(db.Boards.Get(doomed.Board.Id));
        Assert.Empty(db.Columns.GetByBoard(doomed.Board.Id));
        Assert.Null(db.Cards.Get(doomedCard.Id));
        Assert.Null(db.Cards.Get(archived.Id));
        Assert.Empty(db.Labels.GetByWorkspace(doomed.Workspace.Id));
        Assert.Equal(1, db.CountRows("CardLabels"));

        Assert.Equal(2, db.Columns.GetByBoard(survivor.Board.Id).Count);
        Assert.Equal([survivorLabel.Id], db.Cards.Get(survivorCard.Id)!.LabelIds);
        Assert.Single(db.Labels.GetByWorkspace(survivor.Workspace.Id));
        Assert.Equal(1, db.CountRows("Cards"));
    }

    [Fact]
    public void GetContents_CountsBoardsAndAllCards()
    {
        using var db = new TestDatabase();
        var first = db.CreateBoard(columns: 2);
        var second = db.AddBoard(first.Workspace, "Second", columns: 1);
        db.AddCards(first[0].Id, "a", "b");
        db.AddCard(first[1].Id, "c");
        var onSecond = db.AddCard(second[0].Id, "d");
        db.Cards.SetArchived(onSecond.Id, true);

        var other = db.CreateBoard(workspaceName: "Other");
        db.AddCard(other[0].Id, "not counted");

        var contents = db.Workspaces.GetContents(first.Workspace.Id);

        Assert.Equal(new WorkspaceContents(Boards: 2, Cards: 4), contents);
    }

    [Fact]
    public void GetContents_EmptyWorkspace_IsZero()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Empty");
        Assert.Equal(new WorkspaceContents(0, 0), db.Workspaces.GetContents(workspace.Id));
    }

    [Fact]
    public void Workspaces_PersistAfterReopen()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Persistent");
        db.Workspaces.Rename(workspace.Id, "Renamed");
        var gone = db.Workspaces.Create("Gone");
        db.Workspaces.Delete(gone.Id);

        db.Reopen();

        var all = db.Workspaces.GetAll();
        var loaded = Assert.Single(all);
        Assert.Equal("Renamed", loaded.Name);
        Assert.Equal(workspace.Id, loaded.Id);
    }
}
