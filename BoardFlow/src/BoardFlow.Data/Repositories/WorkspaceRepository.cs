using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using Dapper;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

public sealed record WorkspaceContents(int Boards, int Cards);

public sealed class WorkspaceRepository(BoardFlowDatabase database, IClock clock, ILogger<WorkspaceRepository> logger)
    : RepositoryBase(database, clock, logger)
{
    private const string Columns = "Id, Name, CreatedAt, UpdatedAt";

    public IReadOnlyList<Workspace> GetAll() => Read("load workspaces", c =>
        c.Query<Workspace>($"SELECT {Columns} FROM Workspaces ORDER BY Name COLLATE NOCASE, Id").AsList());

    public Workspace? Get(long id) => Read("load workspace", c =>
        c.QuerySingleOrDefault<Workspace>($"SELECT {Columns} FROM Workspaces WHERE Id = @id", new { id }));

    public Workspace Create(string name)
    {
        var workspace = new Workspace { Name = Validate.Name(name, "Workspace name"), CreatedAt = Clock.UtcNow };
        workspace.UpdatedAt = workspace.CreatedAt;
        workspace.Id = Write("create the workspace", (c, t) => c.ExecuteScalar<long>(
            "INSERT INTO Workspaces (Name, CreatedAt, UpdatedAt) VALUES (@Name, @CreatedAt, @UpdatedAt) RETURNING Id",
            workspace, t));
        Logger.LogInformation("Created workspace {WorkspaceId}", workspace.Id);
        return workspace;
    }

    public void Rename(long id, string name)
    {
        var validName = Validate.Name(name, "Workspace name");
        Write("rename the workspace", (c, t) =>
        {
            var rows = c.Execute(
                "UPDATE Workspaces SET Name = @validName, UpdatedAt = @now WHERE Id = @id",
                new { id, validName, now = Clock.UtcNow }, t);
            if (rows == 0)
            {
                throw Missing("Workspace", id);
            }
        });
    }

    public WorkspaceContents GetContents(long id) => Read("count workspace contents", c => new WorkspaceContents(
        c.ExecuteScalar<int>("SELECT COUNT(*) FROM Boards WHERE WorkspaceId = @id", new { id }),
        c.ExecuteScalar<int>(
            """
            SELECT COUNT(*) FROM Cards k
            JOIN BoardColumns col ON col.Id = k.ColumnId
            JOIN Boards b ON b.Id = col.BoardId
            WHERE b.WorkspaceId = @id
            """, new { id })));

    /// <summary>Deletes the workspace and, through cascading foreign keys, all of its boards, columns, cards and labels.</summary>
    public void Delete(long id)
    {
        Write("delete the workspace", (c, t) =>
        {
            if (c.Execute("DELETE FROM Workspaces WHERE Id = @id", new { id }, t) == 0)
            {
                throw Missing("Workspace", id);
            }
        });
        Logger.LogInformation("Deleted workspace {WorkspaceId}", id);
    }
}
