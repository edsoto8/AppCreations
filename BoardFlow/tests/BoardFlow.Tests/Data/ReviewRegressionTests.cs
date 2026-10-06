using System.Globalization;
using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using BoardFlow.Data;
using BoardFlow.Data.Repositories;
using BoardFlow.Data.Schema;
using BoardFlow.Tests.Support;
using Dapper;
using Microsoft.Extensions.Logging.Abstractions;

namespace BoardFlow.Tests.Data;

/// <summary>Regression tests for defects found in the independent review.</summary>
public sealed class ReviewRegressionTests
{
    [Fact]
    public void Timestamps_AreStoredAsIsoUtcText()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Work");

        using var connection = db.Database.Open();
        var raw = connection.ExecuteScalar<string>("SELECT CreatedAt FROM Workspaces WHERE Id = @Id", workspace);

        Assert.Equal(workspace.CreatedAt.ToString("O", CultureInfo.InvariantCulture), raw);
        Assert.EndsWith("Z", raw);
    }

    [Fact]
    public void DueDates_AreStoredAsPlainDates()
    {
        using var db = new TestDatabase();
        var board = db.CreateBoard();
        var card = db.Cards.Create(board[0].Id, new CardInput("Due", DueDate: new DateOnly(2026, 12, 31)));

        using var connection = db.Database.Open();
        Assert.Equal("2026-12-31", connection.ExecuteScalar<string>("SELECT DueDate FROM Cards WHERE Id = @Id", card));
    }

    [Fact]
    public void Timestamps_WithoutZoneMarker_AreReadAsUtc()
    {
        using var db = new TestDatabase();
        var workspace = db.Workspaces.Create("Work");
        using (var connection = db.Database.Open())
        {
            connection.Execute(
                "UPDATE Workspaces SET CreatedAt = '2026-03-10 09:00:00.004' WHERE Id = @Id", workspace);
        }

        var loaded = db.Workspaces.Get(workspace.Id)!;

        Assert.Equal(new DateTime(2026, 3, 10, 9, 0, 0, 4, DateTimeKind.Utc), loaded.CreatedAt);
        Assert.Equal(DateTimeKind.Utc, loaded.CreatedAt.Kind);
    }

    [Fact]
    public void Update_WithNewColumn_SavesFieldsAndMovesTogether()
    {
        using var db = new TestDatabase();
        var board = db.CreateBoard();
        db.Cards.Create(board[1].Id, new CardInput("Already there"));
        var card = db.Cards.Create(board[0].Id, new CardInput("Old"));

        var updated = db.Cards.Update(card.Id, new CardInput("New", Priority: Priority.High), board[1].Id);

        Assert.Equal("New", updated.Title);
        Assert.Equal(board[1].Id, updated.ColumnId);
        Assert.Equal(1, updated.SortOrder);
    }

    [Fact]
    public void Update_WithColumnOnAnotherBoard_ChangesNothing()
    {
        using var db = new TestDatabase();
        var board = db.CreateBoard();
        var other = db.AddBoard(board.Workspace, "Other");
        var card = db.Cards.Create(board[0].Id, new CardInput("Original", Priority: Priority.Low));

        Assert.Throws<ValidationException>(() =>
            db.Cards.Update(card.Id, new CardInput("Changed", Priority: Priority.High), other[0].Id));

        var stored = db.Cards.Get(card.Id)!;
        Assert.Equal("Original", stored.Title);
        Assert.Equal(Priority.Low, stored.Priority);
        Assert.Equal(board[0].Id, stored.ColumnId);
    }

    [Fact]
    public void DeleteColumnMovingCards_KeepsArchivedCardsArchiveDate()
    {
        using var db = new TestDatabase();
        var board = db.CreateBoard();
        var archived = db.Cards.Create(board[0].Id, new CardInput("Old news"));
        db.Cards.SetArchived(archived.Id, true);
        var archivedAt = db.Cards.Get(archived.Id)!.UpdatedAt;
        db.Clock.Advance(TimeSpan.FromDays(3));

        db.Columns.Delete(board[0].Id, ColumnCardHandling.MoveToColumn, board[1].Id);

        var moved = db.Cards.Get(archived.Id)!;
        Assert.Equal(board[1].Id, moved.ColumnId);
        Assert.Equal(archivedAt, moved.UpdatedAt);
    }

    [Fact]
    public void Initialize_UnusableDataFolder_ThrowsPersistenceException()
    {
        using var dir = new TempDirectory();
        var blocker = Path.Combine(dir.Path, "not-a-folder");
        File.WriteAllText(blocker, "a file where a folder should be");
        var database = new BoardFlowDatabase(Path.Combine(blocker, "data", "boardflow.db"));

        var ex = Assert.Throws<PersistenceException>(() =>
            new DatabaseInitializer(database, NullLogger<DatabaseInitializer>.Instance).Initialize());

        Assert.Contains("has not been changed", ex.Message);
        Assert.Equal("a file where a folder should be", File.ReadAllText(blocker));
    }

    [Fact]
    public void Search_DoesNotDependOnCurrentCulture()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
            var card = new Card { Title = "LOGIN page", Description = "" };

            Assert.True(new CardFilter { SearchText = "login" }.Matches(card, new DateOnly(2026, 1, 1)));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }
}
