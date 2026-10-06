using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using Dapper;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

public sealed class LabelRepository(BoardFlowDatabase database, IClock clock, ILogger<LabelRepository> logger)
    : RepositoryBase(database, clock, logger)
{
    private const string Columns = "Id, WorkspaceId, Name, DisplayColor";

    public IReadOnlyList<Label> GetByWorkspace(long workspaceId) => Read("load labels", c =>
        c.Query<Label>(
            $"SELECT {Columns} FROM Labels WHERE WorkspaceId = @workspaceId ORDER BY Name COLLATE NOCASE, Id",
            new { workspaceId }).AsList());

    public Label Create(long workspaceId, string name, string color)
    {
        var label = new Label { WorkspaceId = workspaceId, Name = Validate.LabelName(name), DisplayColor = Validate.Color(color) };
        label.Id = Write("create the label", (c, t) =>
        {
            EnsureUniqueName(c, t, workspaceId, label.Name, null);
            return c.ExecuteScalar<long>(
                "INSERT INTO Labels (WorkspaceId, Name, DisplayColor) VALUES (@WorkspaceId, @Name, @DisplayColor) RETURNING Id",
                label, t);
        });
        return label;
    }

    public void Update(long id, string name, string color)
    {
        var validName = Validate.LabelName(name);
        var validColor = Validate.Color(color);
        Write("save the label", (c, t) =>
        {
            var workspaceId = c.ExecuteScalar<long?>("SELECT WorkspaceId FROM Labels WHERE Id = @id", new { id }, t)
                ?? throw Missing("Label", id);
            EnsureUniqueName(c, t, workspaceId, validName, id);
            c.Execute("UPDATE Labels SET Name = @validName, DisplayColor = @validColor WHERE Id = @id",
                new { id, validName, validColor }, t);
        });
    }

    /// <summary>Deletes the label and removes it from every card (cards themselves are kept).</summary>
    public void Delete(long id) => Write("delete the label", (c, t) =>
    {
        if (c.Execute("DELETE FROM Labels WHERE Id = @id", new { id }, t) == 0)
        {
            throw Missing("Label", id);
        }
    });

    public int CountUsage(long id) => Read("count label usage", c =>
        c.ExecuteScalar<int>("SELECT COUNT(*) FROM CardLabels WHERE LabelId = @id", new { id }));

    private static void EnsureUniqueName(SqliteConnection c, SqliteTransaction t, long workspaceId, string name, long? exceptId)
    {
        var clash = c.ExecuteScalar<long>(
            "SELECT COUNT(*) FROM Labels WHERE WorkspaceId = @workspaceId AND Name = @name COLLATE NOCASE AND Id IS NOT @exceptId",
            new { workspaceId, name, exceptId }, t);
        if (clash > 0)
        {
            throw new ValidationException($"A label named '{name}' already exists in this workspace.");
        }
    }
}
