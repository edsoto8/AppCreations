using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using BoardFlow.Data;
using BoardFlow.Tests.Support;

namespace BoardFlow.Tests.Data;

public sealed class LabelRepositoryTests
{
    [Fact]
    public void Create_NormalisesColorAndTrimsName()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        var label = db.Labels.Create(workspace.Id, "  Urgent ", "#e5534b");

        Assert.Equal("Urgent", label.Name);
        Assert.Equal("#E5534B", label.DisplayColor);
        var stored = Assert.Single(db.Labels.GetByWorkspace(workspace.Id));
        Assert.Equal(label.Id, stored.Id);
        Assert.Equal("#E5534B", stored.DisplayColor);
        Assert.Equal(workspace.Id, stored.WorkspaceId);
    }

    [Theory]
    [InlineData("", "#E5534B")]
    [InlineData("  ", "#E5534B")]
    [InlineData("Name", "red")]
    [InlineData("Name", "#12345")]
    public void Create_InvalidInput_ThrowsAndWritesNothing(string name, string color)
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");

        Assert.Throws<ValidationException>(() => db.Labels.Create(workspace.Id, name, color));

        Assert.Empty(db.Labels.GetByWorkspace(workspace.Id));
    }

    [Fact]
    public void Create_NameTooLong_Throws()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        Assert.Throws<ValidationException>(() =>
            db.Labels.Create(workspace.Id, new string('l', Validate.LabelNameMaxLength + 1), "#E5534B"));
    }

    [Theory]
    [InlineData("urgent")]
    [InlineData("URGENT")]
    [InlineData("  Urgent  ")]
    public void Create_DuplicateNameInSameWorkspace_IgnoringCase_Throws(string duplicate)
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        db.Labels.Create(workspace.Id, "Urgent", "#E5534B");

        var ex = Assert.Throws<ValidationException>(() => db.Labels.Create(workspace.Id, duplicate, "#3A7BD5"));

        Assert.Contains("already exists", ex.Message);
        Assert.Single(db.Labels.GetByWorkspace(workspace.Id));
    }

    [Fact]
    public void Create_SameNameInAnotherWorkspace_IsAllowed()
    {
        using var db = new TestDatabase();
        var a = db.Workspaces.Create("A");
        var b = db.Workspaces.Create("B");
        db.Labels.Create(a.Id, "Urgent", "#E5534B");

        var inB = db.Labels.Create(b.Id, "urgent", "#3A7BD5");

        Assert.Equal(b.Id, inB.WorkspaceId);
        Assert.Single(db.Labels.GetByWorkspace(a.Id));
        Assert.Single(db.Labels.GetByWorkspace(b.Id));
    }

    [Fact]
    public void GetByWorkspace_OrdersByNameIgnoringCase()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        db.Labels.Create(workspace.Id, "charlie", "#E5534B");
        db.Labels.Create(workspace.Id, "Bravo", "#E5534B");
        db.Labels.Create(workspace.Id, "alpha", "#E5534B");

        Assert.Equal(["alpha", "Bravo", "charlie"], db.Labels.GetByWorkspace(workspace.Id).Select(l => l.Name));
    }

    [Fact]
    public void Update_ChangesNameAndColor()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var label = db.Labels.Create(workspace.Id, "Old", "#E5534B");

        db.Labels.Update(label.Id, " New ", "#3a7bd5");

        var stored = Assert.Single(db.Labels.GetByWorkspace(workspace.Id));
        Assert.Equal("New", stored.Name);
        Assert.Equal("#3A7BD5", stored.DisplayColor);
    }

    [Fact]
    public void Update_CanChangeOnlyTheCaseOfItsOwnName()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var label = db.Labels.Create(workspace.Id, "urgent", "#E5534B");

        db.Labels.Update(label.Id, "URGENT", "#E5534B");

        Assert.Equal("URGENT", Assert.Single(db.Labels.GetByWorkspace(workspace.Id)).Name);
    }

    [Fact]
    public void Update_ToAnotherLabelsName_ThrowsAndKeepsOldValues()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        db.Labels.Create(workspace.Id, "Bug", "#E5534B");
        var feature = db.Labels.Create(workspace.Id, "Feature", "#3A7BD5");

        Assert.Throws<ValidationException>(() => db.Labels.Update(feature.Id, "bug", "#4CAF6A"));

        var stored = db.Labels.GetByWorkspace(workspace.Id).Single(l => l.Id == feature.Id);
        Assert.Equal("Feature", stored.Name);
        Assert.Equal("#3A7BD5", stored.DisplayColor);
    }

    [Fact]
    public void Update_InvalidColor_Throws()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var label = db.Labels.Create(workspace.Id, "Bug", "#E5534B");

        Assert.Throws<ValidationException>(() => db.Labels.Update(label.Id, "Bug", "blue"));

        Assert.Equal("#E5534B", Assert.Single(db.Labels.GetByWorkspace(workspace.Id)).DisplayColor);
    }

    [Fact]
    public void Update_MissingLabel_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Labels.Update(999, "Name", "#E5534B"));
    }

    [Fact]
    public void Delete_RemovesLabelFromCardsButKeepsTheCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var bug = db.Labels.Create(fixture.Workspace.Id, "Bug", "#E5534B");
        var feature = db.Labels.Create(fixture.Workspace.Id, "Feature", "#3A7BD5");
        var first = db.Cards.Create(fixture[0].Id, new CardInput("First", LabelIds: [bug.Id, feature.Id]));
        var second = db.Cards.Create(fixture[1].Id, new CardInput("Second", LabelIds: [bug.Id]));

        db.Labels.Delete(bug.Id);

        Assert.Equal([feature.Id], db.Cards.Get(first.Id)!.LabelIds);
        Assert.Empty(db.Cards.Get(second.Id)!.LabelIds);
        Assert.Equal(["Feature"], db.Labels.GetByWorkspace(fixture.Workspace.Id).Select(l => l.Name));
        Assert.Equal(2, db.CountRows("Cards"));
        Assert.Equal(0, db.Labels.CountUsage(bug.Id));
    }

    [Fact]
    public void Delete_MissingLabel_ThrowsNotFound()
    {
        using var db = new TestDatabase();
        Assert.Throws<NotFoundException>(() => db.Labels.Delete(999));
    }

    [Fact]
    public void CountUsage_CountsCardsCarryingTheLabel()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var bug = db.Labels.Create(fixture.Workspace.Id, "Bug", "#E5534B");
        var unused = db.Labels.Create(fixture.Workspace.Id, "Unused", "#3A7BD5");
        var a = db.Cards.Create(fixture[0].Id, new CardInput("A", LabelIds: [bug.Id]));
        db.Cards.Create(fixture[0].Id, new CardInput("B", LabelIds: [bug.Id]));
        db.Cards.Create(fixture[1].Id, new CardInput("C"));

        Assert.Equal(2, db.Labels.CountUsage(bug.Id));
        Assert.Equal(0, db.Labels.CountUsage(unused.Id));

        db.Cards.Update(a.Id, new CardInput("A"));
        Assert.Equal(1, db.Labels.CountUsage(bug.Id));
    }

    [Fact]
    public void CountUsage_IncludesArchivedCards()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var bug = db.Labels.Create(fixture.Workspace.Id, "Bug", "#E5534B");
        var card = db.Cards.Create(fixture[0].Id, new CardInput("A", LabelIds: [bug.Id]));
        db.Cards.SetArchived(card.Id, true);

        Assert.Equal(1, db.Labels.CountUsage(bug.Id));
    }

    [Fact]
    public void Labels_PersistAfterReopen()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Personal");
        var label = db.Labels.Create(workspace.Id, "Bug", "#e5534b");

        db.Reopen();

        var stored = Assert.Single(db.Labels.GetByWorkspace(workspace.Id));
        Assert.Equal(label.Id, stored.Id);
        Assert.Equal("Bug", stored.Name);
        Assert.Equal("#E5534B", stored.DisplayColor);
    }

    [Fact]
    public void Create_InMissingWorkspace_ThrowsNotFound()
    {
        using var db = new TestDatabase();

        Assert.Throws<NotFoundException>(() => db.Labels.Create(9999, "Orphan", "#123456"));
    }
}
