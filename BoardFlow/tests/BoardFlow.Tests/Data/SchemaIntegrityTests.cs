using BoardFlow.Tests.Support;
using Dapper;
using Microsoft.Data.Sqlite;

namespace BoardFlow.Tests.Data;

public sealed class SchemaIntegrityTests
{
    [Fact]
    public void InsertingACardWithAnUnknownColumn_IsRejectedByForeignKeys()
    {
        using var db = new TestDatabase();
        using var connection = db.Database.Open();

        var ex = Assert.Throws<SqliteException>(() => connection.Execute(
            """
            INSERT INTO Cards (ColumnId, Title, Description, Priority, IsArchived, SortOrder, CreatedAt, UpdatedAt)
            VALUES (999999, 'Orphan', '', 0, 0, 0, 't', 't')
            """));

        Assert.Equal(19, ex.SqliteErrorCode); // SQLITE_CONSTRAINT
        Assert.Equal(0, db.CountRows("Cards"));
    }

    [Fact]
    public void InsertingACardLabelForUnknownCardOrLabel_IsRejected()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        var card = db.AddCard(fixture[0].Id, "Card");
        using var connection = db.Database.Open();

        Assert.Throws<SqliteException>(() =>
            connection.Execute("INSERT INTO CardLabels (CardId, LabelId) VALUES (@CardId, 999)", new { CardId = card.Id }));
        Assert.Throws<SqliteException>(() =>
            connection.Execute("INSERT INTO CardLabels (CardId, LabelId) VALUES (999, 1)"));
    }

    [Fact]
    public void PriorityOutsideTheEnumRange_IsRejectedByCheckConstraint()
    {
        using var db = new TestDatabase();
        var fixture = db.CreateBoard();
        using var connection = db.Database.Open();

        Assert.Throws<SqliteException>(() => connection.Execute(
            """
            INSERT INTO Cards (ColumnId, Title, Description, Priority, IsArchived, SortOrder, CreatedAt, UpdatedAt)
            VALUES (@ColumnId, 'Bad', '', 9, 0, 0, 't', 't')
            """, new { ColumnId = fixture[0].Id }));
    }

    [Fact]
    public void ConnectionsFromTheDatabase_HaveForeignKeysEnabled()
    {
        using var db = new TestDatabase();
        using var connection = db.Database.Open();

        Assert.Equal(1, connection.ExecuteScalar<int>("PRAGMA foreign_keys;"));
    }
}
