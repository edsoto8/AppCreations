using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

public sealed record BoardContents(int Columns, int Cards);

public sealed class BoardRepository(BoardFlowDatabase database, IClock clock, ILogger<BoardRepository> logger)
    : RepositoryBase(database, clock, logger)
{
    private const string Columns = "Id, WorkspaceId, Name, Description, CreatedAt, UpdatedAt, SortOrder";

    public IReadOnlyList<Board> GetByWorkspace(long workspaceId) => Read("load boards", c =>
        c.Query<Board>(
            $"SELECT {Columns} FROM Boards WHERE WorkspaceId = @workspaceId ORDER BY SortOrder, Id",
            new { workspaceId }).AsList());

    public Board? Get(long id) => Read("load board", c =>
        c.QuerySingleOrDefault<Board>($"SELECT {Columns} FROM Boards WHERE Id = @id", new { id }));

    /// <summary>Creates a board at the end of the workspace, optionally with the default columns.</summary>
    public Board Create(long workspaceId, string name, string? description = null, bool withDefaultColumns = false)
    {
        var board = new Board
        {
            WorkspaceId = workspaceId,
            Name = Validate.Name(name, "Board name"),
            Description = Validate.Description(description),
            CreatedAt = Clock.UtcNow,
        };
        board.UpdatedAt = board.CreatedAt;

        Write("create the board", (c, t) =>
        {
            EnsureWorkspaceExists(c, t, workspaceId);
            board.SortOrder = c.ExecuteScalar<int>(
                "SELECT COALESCE(MAX(SortOrder) + 1, 0) FROM Boards WHERE WorkspaceId = @workspaceId",
                new { workspaceId }, t);
            board.Id = c.ExecuteScalar<long>(
                """
                INSERT INTO Boards (WorkspaceId, Name, Description, SortOrder, CreatedAt, UpdatedAt)
                VALUES (@WorkspaceId, @Name, @Description, @SortOrder, @CreatedAt, @UpdatedAt) RETURNING Id
                """, board, t);

            if (withDefaultColumns)
            {
                ColumnRepository.InsertColumns(c, t, board.Id, DefaultColumns.Names, Clock.UtcNow);
            }
        });
        Logger.LogInformation("Created board {BoardId} in workspace {WorkspaceId}", board.Id, workspaceId);
        return board;
    }

    public void Update(long id, string name, string? description)
    {
        var validName = Validate.Name(name, "Board name");
        var validDescription = Validate.Description(description);
        Write("save the board", (c, t) =>
        {
            var rows = c.Execute(
                "UPDATE Boards SET Name = @validName, Description = @validDescription, UpdatedAt = @now WHERE Id = @id",
                new { id, validName, validDescription, now = Clock.UtcNow }, t);
            if (rows == 0)
            {
                throw Missing("Board", id);
            }
        });
    }

    public BoardContents GetContents(long id) => Read("count board contents", c => new BoardContents(
        c.ExecuteScalar<int>("SELECT COUNT(*) FROM BoardColumns WHERE BoardId = @id", new { id }),
        c.ExecuteScalar<int>(
            "SELECT COUNT(*) FROM Cards k JOIN BoardColumns col ON col.Id = k.ColumnId WHERE col.BoardId = @id",
            new { id })));

    /// <summary>Deletes the board and, through cascading foreign keys, its columns and cards.</summary>
    public void Delete(long id)
    {
        Write("delete the board", (c, t) =>
        {
            var workspaceId = c.ExecuteScalar<long?>("SELECT WorkspaceId FROM Boards WHERE Id = @id", new { id }, t)
                ?? throw Missing("Board", id);
            c.Execute("DELETE FROM Boards WHERE Id = @id", new { id }, t);
            Renumber(c, t, workspaceId);
        });
        Logger.LogInformation("Deleted board {BoardId}", id);
    }

    private static void Renumber(SqliteConnection c, SqliteTransaction t, long workspaceId)
    {
        var ids = c.Query<long>(
            "SELECT Id FROM Boards WHERE WorkspaceId = @workspaceId ORDER BY SortOrder, Id", new { workspaceId }, t);
        c.Execute(
            "UPDATE Boards SET SortOrder = @SortOrder WHERE Id = @Id",
            ids.Select((boardId, index) => new { Id = boardId, SortOrder = index }), t);
    }

    private static void EnsureWorkspaceExists(SqliteConnection c, SqliteTransaction t, long workspaceId)
    {
        if (c.ExecuteScalar<long>("SELECT COUNT(*) FROM Workspaces WHERE Id = @workspaceId", new { workspaceId }, t) == 0)
        {
            throw Missing("Workspace", workspaceId);
        }
    }
}
