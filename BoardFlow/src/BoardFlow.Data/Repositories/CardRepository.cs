using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

/// <summary>
/// Cards and their labels. Active (non-archived) cards in a column always have dense sort orders
/// 0..n-1; archived cards keep their column but leave that sequence, and rejoin at the end on restore.
/// </summary>
public sealed class CardRepository(BoardFlowDatabase database, IClock clock, ILogger<CardRepository> logger)
    : RepositoryBase(database, clock, logger)
{
    private const string Columns =
        "k.Id, k.ColumnId, k.Title, k.Description, k.Priority, k.DueDate, k.IsArchived, k.SortOrder, k.CreatedAt, k.UpdatedAt";

    /// <summary>Cards on a board ordered by column then position. Archived cards are excluded unless requested.</summary>
    public IReadOnlyList<Card> GetByBoard(long boardId, bool includeArchived = false) => Read("load cards", c =>
        WithLabels(c, null, c.Query<Card>(
            $"""
            SELECT {Columns} FROM Cards k
            JOIN BoardColumns col ON col.Id = k.ColumnId
            WHERE col.BoardId = @boardId AND (@includeArchived OR k.IsArchived = 0)
            ORDER BY col.SortOrder, col.Id, k.IsArchived, k.SortOrder, k.Id
            """, new { boardId, includeArchived }).AsList()));

    /// <summary>Archived cards on a board, most recently changed first.</summary>
    public IReadOnlyList<Card> GetArchivedByBoard(long boardId) => Read("load archived cards", c =>
        WithLabels(c, null, c.Query<Card>(
            $"""
            SELECT {Columns} FROM Cards k
            JOIN BoardColumns col ON col.Id = k.ColumnId
            WHERE col.BoardId = @boardId AND k.IsArchived = 1
            ORDER BY k.UpdatedAt DESC, k.Id DESC
            """, new { boardId }).AsList()));

    public Card? Get(long id) => Read("load card", c => GetCard(c, null, id));

    /// <summary>Creates a card at the bottom of <paramref name="columnId"/>.</summary>
    public Card Create(long columnId, CardInput input)
    {
        var card = ToCard(input);
        card.ColumnId = columnId;
        card.CreatedAt = card.UpdatedAt = Clock.UtcNow;

        var id = Write("create the card", (c, t) =>
        {
            var workspaceId = WorkspaceOfColumn(c, t, columnId);
            EnsureLabelsBelong(c, t, card.LabelIds, workspaceId);
            card.SortOrder = ActiveCardIds(c, t, columnId).Count;
            card.Id = Insert(c, t, card);
            return card.Id;
        });
        Logger.LogInformation("Created card {CardId} in column {ColumnId}", id, columnId);
        return Get(id) ?? throw Missing("Card", id);
    }

    /// <summary>
    /// Replaces every editable field of the card, including its labels. When <paramref name="targetColumnId"/>
    /// names a different column the card also moves to the bottom of it, in the same transaction.
    /// </summary>
    public Card Update(long id, CardInput input, long? targetColumnId = null)
    {
        var card = ToCard(input);
        Write("save the card", (c, t) =>
        {
            var existing = GetCard(c, t, id) ?? throw Missing("Card", id);
            EnsureLabelsBelong(c, t, card.LabelIds, WorkspaceOfColumn(c, t, existing.ColumnId));
            c.Execute(
                """
                UPDATE Cards SET Title = @Title, Description = @Description, Priority = @Priority,
                    DueDate = @DueDate, UpdatedAt = @now
                WHERE Id = @id
                """, new { id, card.Title, card.Description, card.Priority, card.DueDate, now = Clock.UtcNow }, t);
            ReplaceLabels(c, t, id, card.LabelIds);
            if (targetColumnId is { } target && target != existing.ColumnId)
            {
                MoveCore(c, t, existing, target, null);
            }
        });
        return Get(id) ?? throw Missing("Card", id);
    }

    public void Delete(long id)
    {
        Write("delete the card", (c, t) =>
        {
            var card = GetCard(c, t, id) ?? throw Missing("Card", id);
            c.Execute("DELETE FROM Cards WHERE Id = @id", new { id }, t);
            WriteOrder(c, t, ActiveCardIds(c, t, card.ColumnId), Clock.UtcNow);
        });
        Logger.LogInformation("Deleted card {CardId}", id);
    }

    /// <summary>Archives (hides) or restores a card. A restored card goes to the bottom of its column.</summary>
    public void SetArchived(long id, bool archived)
    {
        Write(archived ? "archive the card" : "restore the card", (c, t) =>
        {
            var card = GetCard(c, t, id) ?? throw Missing("Card", id);
            if (card.IsArchived == archived)
            {
                return;
            }

            var now = Clock.UtcNow;
            var activeIds = ActiveCardIds(c, t, card.ColumnId);
            c.Execute(
                "UPDATE Cards SET IsArchived = @archived, SortOrder = @sortOrder, UpdatedAt = @now WHERE Id = @id",
                new { id, archived, sortOrder = archived ? -1 : activeIds.Count, now }, t);
            if (archived)
            {
                activeIds.Remove(id);
                WriteOrder(c, t, activeIds, now);
            }
        });
        Logger.LogInformation("{Action} card {CardId}", archived ? "Archived" : "Restored", id);
    }

    /// <summary>
    /// Moves an active card into <paramref name="targetColumnId"/> (which may be its current column),
    /// immediately above <paramref name="beforeCardId"/> or at the bottom when null. The whole move is one
    /// transaction computed from the current database state, so repeated or rapid moves cannot duplicate
    /// or lose cards.
    /// </summary>
    public void Move(long id, long targetColumnId, long? beforeCardId) =>
        Write("move the card", (c, t) => MoveCore(c, t, GetCard(c, t, id) ?? throw Missing("Card", id), targetColumnId, beforeCardId));

    /// <summary>Copies a card (fields and labels) directly below the original, titled "… (copy)".</summary>
    public Card Duplicate(long id)
    {
        var copyId = Write("duplicate the card", (c, t) =>
        {
            var original = GetCard(c, t, id) ?? throw Missing("Card", id);
            var now = Clock.UtcNow;
            var copy = new Card
            {
                ColumnId = original.ColumnId,
                Title = CopyTitle(original.Title),
                Description = original.Description,
                Priority = original.Priority,
                DueDate = original.DueDate,
                LabelIds = [.. original.LabelIds],
                CreatedAt = now,
                UpdatedAt = now,
            };

            var activeIds = ActiveCardIds(c, t, original.ColumnId);
            copy.SortOrder = activeIds.Count;
            copy.Id = Insert(c, t, copy);

            var afterOriginal = original.IsArchived ? null : NextActive(activeIds, id);
            WriteOrder(c, t, Ordering.MoveBefore([.. activeIds, copy.Id], copy.Id, afterOriginal), now);
            return copy.Id;
        });
        Logger.LogInformation("Duplicated card {CardId} as {CopyId}", id, copyId);
        return Get(copyId) ?? throw Missing("Card", copyId);
    }

    private void MoveCore(SqliteConnection c, SqliteTransaction t, Card card, long targetColumnId, long? beforeCardId)
    {
        var id = card.Id;
        if (card.IsArchived)
        {
            throw new ValidationException("Archived cards cannot be moved. Restore the card first.");
        }

        var sourceBoard = BoardOfColumn(c, t, card.ColumnId);
        if (BoardOfColumn(c, t, targetColumnId) != sourceBoard)
        {
            throw new ValidationException("Cards can only be moved between columns of the same board.");
        }

        var targetIds = ActiveCardIds(c, t, targetColumnId);
        if (beforeCardId is { } before && (before == id || !targetIds.Contains(before)))
        {
            // The anchor moved or was archived since the UI rendered; fall back to the bottom of the column.
            beforeCardId = before == id ? NextActive(targetIds, id) : null;
        }

        var now = Clock.UtcNow;
        var newTargetOrder = Ordering.MoveBefore(targetIds, id, beforeCardId);
        if (targetColumnId != card.ColumnId)
        {
            c.Execute("UPDATE Cards SET ColumnId = @targetColumnId, UpdatedAt = @now WHERE Id = @id",
                new { id, targetColumnId, now }, t);
            WriteOrder(c, t, ActiveCardIds(c, t, card.ColumnId), now);
        }

        WriteOrder(c, t, newTargetOrder, now);
        Logger.LogDebug("Moved card {CardId} to column {ColumnId} before {BeforeCardId}", id, targetColumnId, beforeCardId);
    }

    internal static List<long> ActiveCardIds(SqliteConnection c, SqliteTransaction t, long columnId) =>
        c.Query<long>(
            "SELECT Id FROM Cards WHERE ColumnId = @columnId AND IsArchived = 0 ORDER BY SortOrder, Id",
            new { columnId }, t).AsList();

    internal static void WriteOrder(SqliteConnection c, SqliteTransaction t, IReadOnlyList<long> orderedIds, DateTime now) =>
        c.Execute(
            "UPDATE Cards SET SortOrder = @SortOrder, UpdatedAt = @now WHERE Id = @Id AND SortOrder <> @SortOrder",
            orderedIds.Select((cardId, index) => new { Id = cardId, SortOrder = index, now }), t);

    private static string CopyTitle(string title)
    {
        const string suffix = " (copy)";
        var room = Validate.TitleMaxLength - suffix.Length;
        return (title.Length > room ? title[..room].TrimEnd() : title) + suffix;
    }

    /// <summary>The id after <paramref name="id"/> in <paramref name="ids"/>, or null if it is last or absent.</summary>
    private static long? NextActive(List<long> ids, long id)
    {
        var index = ids.IndexOf(id);
        return index >= 0 && index + 1 < ids.Count ? ids[index + 1] : null;
    }

    private static Card ToCard(CardInput input) => new()
    {
        Title = Validate.CardTitle(input.Title),
        Description = Validate.Description(input.Description),
        Priority = Validate.Priority(input.Priority),
        DueDate = input.DueDate,
        LabelIds = (input.LabelIds ?? []).Distinct().Order().ToList(),
    };

    private static long Insert(SqliteConnection c, SqliteTransaction t, Card card)
    {
        var id = c.ExecuteScalar<long>(
            """
            INSERT INTO Cards (ColumnId, Title, Description, Priority, DueDate, IsArchived, SortOrder, CreatedAt, UpdatedAt)
            VALUES (@ColumnId, @Title, @Description, @Priority, @DueDate, @IsArchived, @SortOrder, @CreatedAt, @UpdatedAt)
            RETURNING Id
            """, card, t);
        ReplaceLabels(c, t, id, card.LabelIds);
        return id;
    }

    private static void ReplaceLabels(SqliteConnection c, SqliteTransaction t, long cardId, IReadOnlyList<long> labelIds)
    {
        c.Execute("DELETE FROM CardLabels WHERE CardId = @cardId", new { cardId }, t);
        c.Execute(
            "INSERT INTO CardLabels (CardId, LabelId) VALUES (@cardId, @labelId)",
            labelIds.Select(labelId => new { cardId, labelId }), t);
    }

    private static Card? GetCard(SqliteConnection c, SqliteTransaction? t, long id)
    {
        var card = c.QuerySingleOrDefault<Card>($"SELECT {Columns} FROM Cards k WHERE k.Id = @id", new { id }, t);
        return card is null ? null : WithLabels(c, t, [card])[0];
    }

    private static List<Card> WithLabels(SqliteConnection c, SqliteTransaction? t, List<Card> cards)
    {
        if (cards.Count == 0)
        {
            return cards;
        }

        var byId = cards.ToDictionary(card => card.Id);
        var links = c.Query<(long CardId, long LabelId)>(
            "SELECT CardId, LabelId FROM CardLabels WHERE CardId IN @ids ORDER BY LabelId",
            new { ids = byId.Keys.ToArray() }, t);
        foreach (var (cardId, labelId) in links)
        {
            byId[cardId].LabelIds.Add(labelId);
        }

        return cards;
    }

    private static long WorkspaceOfColumn(SqliteConnection c, SqliteTransaction t, long columnId) =>
        c.ExecuteScalar<long?>(
            "SELECT b.WorkspaceId FROM BoardColumns col JOIN Boards b ON b.Id = col.BoardId WHERE col.Id = @columnId",
            new { columnId }, t) ?? throw Missing("Column", columnId);

    private static long BoardOfColumn(SqliteConnection c, SqliteTransaction t, long columnId) =>
        c.ExecuteScalar<long?>("SELECT BoardId FROM BoardColumns WHERE Id = @columnId", new { columnId }, t)
        ?? throw Missing("Column", columnId);

    private static void EnsureLabelsBelong(SqliteConnection c, SqliteTransaction t, IReadOnlyList<long> labelIds, long workspaceId)
    {
        if (labelIds.Count == 0)
        {
            return;
        }

        var valid = c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM Labels WHERE Id IN @labelIds AND WorkspaceId = @workspaceId",
            new { labelIds, workspaceId }, t);
        if (valid != labelIds.Count)
        {
            throw new ValidationException("One or more selected labels no longer exist in this workspace.");
        }
    }
}
