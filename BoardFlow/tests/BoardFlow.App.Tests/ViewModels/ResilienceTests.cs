using Avalonia.Headless.XUnit;
using BoardFlow.App.Infrastructure;
using BoardFlow.App.Views;
using BoardFlow.Tests.App.Support;
using Dapper;
using Microsoft.Data.Sqlite;

namespace BoardFlow.Tests.App.ViewModels;

public sealed class ResilienceTests
{
    [AvaloniaFact]
    public async Task FailedWrite_ShowsUserMessage_LogsIt_AndKeepsData()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Seed.AddCard(s, 0, "Safe");

        // Make every card update fail at the database level.
        using (var connection = new SqliteConnection($"Data Source={Path.Combine(s.DataDirectory, "boardflow.db")}"))
        {
            connection.Execute("CREATE TRIGGER block_moves BEFORE UPDATE ON Cards BEGIN SELECT RAISE(ABORT, 'disk says no'); END;");
        }

        var card = s.Board.Columns[0].Cards[0];
        s.Board.MoveCardToAdjacentColumn(card, 1);

        Assert.True(s.Main.Notifier.IsError);
        Assert.Contains("Could not move the card", s.Main.Notifier.Message);
        Assert.Equal(["Safe"], s.Board.Columns[0].Cards.Select(c => c.Title));

        s.Session.Dispose();
        var log = string.Join('\n', Directory.GetFiles(Path.Combine(s.DataDirectory, "logs")).Select(File.ReadAllText));
        Assert.Contains("move the card", log);
        Assert.Contains("disk says no", log);
    }

    [AvaloniaFact]
    public void CorruptDatabase_ShowsErrorWindow_AndLeavesFileUntouched()
    {
        var dir = Path.Combine(Path.GetTempPath(), "boardflow-ui-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "boardflow.db");
        var garbage = "this is not a database, but it is someone's file"u8.ToArray();
        File.WriteAllBytes(path, garbage);

        var session = AppSession.Start(new AppPaths(dir), Serilog.Core.Logger.None, new FakeClock());
        try
        {
            Assert.IsType<StartupErrorWindow>(session.Window);
            Assert.Null(session.Main);
        }
        finally
        {
            session.Dispose();
        }

        Assert.Equal(garbage, File.ReadAllBytes(path));
        Directory.Delete(dir, recursive: true);
    }

    [AvaloniaFact]
    public async Task StaleCard_IsReportedAndBoardRefreshes()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Ghost");
        var tile = s.Board.FindCard(card.Id)!;
        s.Cards.Delete(card.Id);

        await s.Board.OpenCardCommand.ExecuteAsync(tile);

        Assert.Null(s.Main.Panels.Current);
        Assert.True(s.Main.Notifier.IsError);
        Assert.Empty(s.Board.Columns[0].Cards);
    }
}
