using BoardFlow.Core;
using Dapper;
using Microsoft.Extensions.Logging;

namespace BoardFlow.Data.Repositories;

/// <summary>Small key/value store for UI state such as the last opened board.</summary>
public sealed class SettingsRepository(BoardFlowDatabase database, IClock clock, ILogger<SettingsRepository> logger)
    : RepositoryBase(database, clock, logger)
{
    public const string LastWorkspaceId = "LastWorkspaceId";
    public const string LastBoardId = "LastBoardId";

    public string? Get(string key) => Read("load settings", c =>
        c.ExecuteScalar<string?>("SELECT Value FROM AppSettings WHERE Key = @key", new { key }));

    public long? GetLong(string key) => long.TryParse(Get(key), out var value) ? value : null;

    public void Set(string key, string? value) => Write("save settings", (c, t) =>
    {
        if (value is null)
        {
            c.Execute("DELETE FROM AppSettings WHERE Key = @key", new { key }, t);
        }
        else
        {
            c.Execute(
                "INSERT INTO AppSettings (Key, Value) VALUES (@key, @value) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value",
                new { key, value }, t);
        }
    });
}
