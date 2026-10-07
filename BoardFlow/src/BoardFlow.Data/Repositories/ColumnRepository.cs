using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

/// <summary>What to do with a column's cards (including archived ones) when the column is deleted.</summary>
public enum ColumnCardHandling
{
    /// <summary>Refuse to delete a column that still holds cards.</summary>
    RefuseIfNotEmpty,

    /// <summary>Move every card to another column of the same board, keeping their order.</summary>
    MoveToColumn,

    /// <summary>Permanently delete the cards with the column.</summary>
    DeleteCards,
}

public sealed record ColumnCardCount(int Active, int Archived)
{
    public int Total => Active + Archived;
}

public sealed class ColumnRepository(BoardFlowDatabase database, IClock clock, ILogger<ColumnRepository> logger)
    : RepositoryBase(database, clock, logger)
{
    private const string Columns = "Id, BoardId, Name, SortOrder, CreatedAt, UpdatedAt";

    public IReadOnlyList<BoardColumn> GetByBoard(long boardId) => Read("load columns", c =>
        c.Query<BoardColumn>(
            $"SELECT {Columns} FROM BoardColumns WHERE BoardId = @boardId ORDER BY SortOrder, Id",
            new { boardId }).AsList());

    public BoardColumn? Get(long id) => Read("load column", c =>
        c.QuerySingleOrDefault<BoardColumn>($"SELECT {Columns} FROM BoardColumns WHERE Id = @id", new { id }));

    /// <summary>Adds a column at the right-hand end of the board.</summary>
    public BoardColumn Create(long boardId, string name)
    {
        var validName = Validate.Name(name, "Column name");
        var id = Write("add the column", (c, t) =>
        {
            EnsureBoardExists(c, t, boardId);
            return InsertColumns(c, t, boardId, [validName], Clock.UtcNow)[0];
        });
        Logger.LogInformation("Created column {ColumnId} on board {BoardId}", id, boardId);
        return Get(id) ?? throw Missing("Column", id);
    }

    /// <summary>Appends the default columns (Backlog … Done) to the board.</summary>
    public IReadOnlyList<BoardColumn> AddDefaultColumns(long boardId)
    {
        Write("add the default columns", (c, t) =>
        {
            EnsureBoardExists(c, t, boardId);
            InsertColumns(c, t, boardId, DefaultColumns.Names, Clock.UtcNow);
        });
        return GetByBoard(boardId);
    }

    public void Rename(long id, string name)
    {
        var validName = Validate.Name(name, "Column name");
        Write("rename the column", (c, t) =>
        {
            var rows = c.Execute(
                "UPDATE BoardColumns SET Name = @validName, UpdatedAt = @now WHERE Id = @id",
                new { id, validName, now = Clock.UtcNow }, t);
            if (rows == 0)
            {
                throw Missing("Column", id);
            }
        });
    }

    /// <summary>Moves the column so it sits immediately left of <paramref name="beforeColumnId"/>, or last when null.</summary>
    /// <remarks>Placing a column before itself leaves the order unchanged.</remarks>
    public void Move(long id, long? beforeColumnId) =>
        Reorder(id, ids => beforeColumnId == id ? ids : Ordering.MoveBefore(ids, id, beforeColumnId), beforeColumnId);

    /// <summary>Moves the column <paramref name="offset"/> places (negative = left), clamped to the board edges.</summary>
    public void MoveBy(long id, int offset) => Reorder(id, ids => Ordering.MoveBy(ids, id, offset), null);

    public ColumnCardCount CountCards(long id) => Read("count cards", c =>
    {
        var (active, archived) = c.QuerySingle<(long Active, long Archived)>(
            """
            SELECT COALESCE(SUM(IsArchived = 0), 0) AS Active, COALESCE(SUM(IsArchived = 1), 0) AS Archived
            FROM Cards WHERE ColumnId = @id
            """, new { id });
        return new ColumnCardCount((int)active, (int)archived);
    });

    /// <summary>
    /// Deletes a column. Cards are never removed implicitly: a non-empty column needs either
    /// <see cref="ColumnCardHandling.MoveToColumn"/> (with a target on the same board) or an explicit
    /// <see cref="ColumnCardHandling.DeleteCards"/>.
    /// </summary>
    public void Delete(long id, ColumnCardHandling handling = ColumnCardHandling.RefuseIfNotEmpty, long? targetColumnId = null)
    {
        Write("delete the column", (c, t) =>
        {
            var column = c.QuerySingleOrDefault<BoardColumn>(
                $"SELECT {Columns} FROM BoardColumns WHERE Id = @id", new { id }, t) ?? throw Missing("Column", id);
            var cardCount = c.ExecuteScalar<int>("SELECT COUNT(*) FROM Cards WHERE ColumnId = @id", new { id }, t);

            if (cardCount > 0)
            {
                switch (handling)
                {
                    case ColumnCardHandling.RefuseIfNotEmpty:
                        throw new ValidationException(
                            $"Column '{column.Name}' still holds {cardCount} card(s). Move or delete them first.");
                    case ColumnCardHandling.MoveToColumn:
                        MoveAllCards(c, t, column, targetColumnId);
                        break;
                    case ColumnCardHandling.DeleteCards:
                        Logger.LogInformation("Deleting {CardCount} card(s) with column {ColumnId}", cardCount, id);
                        break;
                }
            }

            c.Execute("DELETE FROM BoardColumns WHERE Id = @id", new { id }, t);
            WriteOrder(c, t, ColumnIds(c, t, column.BoardId), Clock.UtcNow);
        });
        Logger.LogInformation("Deleted column {ColumnId}", id);
    }

    internal static List<long> InsertColumns(
        SqliteConnection c, SqliteTransaction t, long boardId, IEnumerable<string> names, DateTime now)
    {
        var next = c.ExecuteScalar<int>(
            "SELECT COALESCE(MAX(SortOrder) + 1, 0) FROM BoardColumns WHERE BoardId = @boardId", new { boardId }, t);
        var ids = new List<long>();
        foreach (var name in names)
        {
            ids.Add(c.ExecuteScalar<long>(
                """
                INSERT INTO BoardColumns (BoardId, Name, SortOrder, CreatedAt, UpdatedAt)
                VALUES (@boardId, @name, @sortOrder, @now, @now) RETURNING Id
                """, new { boardId, name, sortOrder = next++, now }, t));
        }

        return ids;
    }

    private void Reorder(long id, Func<List<long>, List<long>> reorder, long? beforeColumnId)
    {
        Write("reorder the columns", (c, t) =>
        {
            var boardId = c.ExecuteScalar<long?>("SELECT BoardId FROM BoardColumns WHERE Id = @id", new { id }, t)
                ?? throw Missing("Column", id);
            var ids = ColumnIds(c, t, boardId);
            if (beforeColumnId is { } before && !ids.Contains(before))
            {
                throw new ValidationException("Columns can only be reordered within the same board.");
            }

            WriteOrder(c, t, reorder(ids), Clock.UtcNow);
        });
    }

    private void MoveAllCards(SqliteConnection c, SqliteTransaction t, BoardColumn source, long? targetColumnId)
    {
        if (targetColumnId is not { } targetId || targetId == source.Id)
        {
            throw new ValidationException("Choose a different column to move the cards to.");
        }

        var targetBoardId = c.ExecuteScalar<long?>(
            "SELECT BoardId FROM BoardColumns WHERE Id = @targetId", new { targetId }, t);
        if (targetBoardId != source.BoardId)
        {
            throw new ValidationException("Cards can only be moved to a column on the same board.");
        }

        // Active cards go to the end of the target, in their current order. Archived cards keep their flag.
        var targetIds = CardRepository.ActiveCardIds(c, t, targetId);
        var movingIds = CardRepository.ActiveCardIds(c, t, source.Id);
        var now = Clock.UtcNow;
        // Archived cards keep their UpdatedAt: the archive browser shows it as the archive date.
        c.Execute(
            """
            UPDATE Cards SET ColumnId = @targetId, UpdatedAt = CASE WHEN IsArchived = 0 THEN @now ELSE UpdatedAt END
            WHERE ColumnId = @sourceId
            """,
            new { targetId, sourceId = source.Id, now }, t);
        CardRepository.WriteOrder(c, t, [.. targetIds, .. movingIds], now);
        Logger.LogInformation(
            "Moved cards from column {SourceColumnId} to {TargetColumnId}", source.Id, targetId);
    }

    private static List<long> ColumnIds(SqliteConnection c, SqliteTransaction t, long boardId) =>
        c.Query<long>(
            "SELECT Id FROM BoardColumns WHERE BoardId = @boardId ORDER BY SortOrder, Id", new { boardId }, t).AsList();

    private static void WriteOrder(SqliteConnection c, SqliteTransaction t, IReadOnlyList<long> orderedIds, DateTime now) =>
        c.Execute(
            "UPDATE BoardColumns SET SortOrder = @SortOrder, UpdatedAt = @now WHERE Id = @Id AND SortOrder <> @SortOrder",
            orderedIds.Select((columnId, index) => new { Id = columnId, SortOrder = index, now }), t);

    private static void EnsureBoardExists(SqliteConnection c, SqliteTransaction t, long boardId)
    {
        if (c.ExecuteScalar<long>("SELECT COUNT(*) FROM Boards WHERE Id = @boardId", new { boardId }, t) == 0)
        {
            throw Missing("Board", boardId);
        }
    }
}
