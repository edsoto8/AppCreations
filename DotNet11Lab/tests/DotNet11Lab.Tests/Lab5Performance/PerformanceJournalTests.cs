using DotNet11Lab.Core.Labs.Performance;

namespace DotNet11Lab.Tests.Lab5Performance;

public class PerformanceJournalTests
{
    private static LiveRun Run(string id, DateTimeOffset at, params (string Workload, double Mean)[] results) =>
        new(id, at, ".NET 11.0.0", "Release", "test-machine", 1,
            results.Select(r => new LiveResult("parse", r.Workload, 100, r.Mean, 64, 1_000_000 / r.Mean, 0, 1, 42, "sum")).ToList());

    [Fact]
    public async Task Records_runs_and_reads_them_back_newest_first()
    {
        var ct = TestContext.Current.CancellationToken;
        using var dir = new TempDirectory();
        var journal = new PerformanceJournal(Path.Combine(dir.Path, "nested", "journal.db"));
        var t0 = new DateTimeOffset(2026, 11, 1, 12, 0, 0, TimeSpan.Zero);

        await journal.RecordAsync(Run("run-a", t0, ("string.Split", 50), ("Span Split + ranges", 25)), ct);
        await journal.RecordAsync(Run("run-b", t0.AddMinutes(5), ("string.Split", 48)), ct);

        var all = await journal.GetRecentAsync(10, cancellationToken: ct);
        Assert.Equal(3, await journal.CountAsync(ct));
        Assert.Equal(["run-b", "run-a", "run-a"], all.Select(e => e.RunId));
        var first = all[0];
        Assert.Equal(t0.AddMinutes(5), first.RecordedUtc);
        Assert.Equal("Release", first.Build);
        Assert.Equal(".NET 11.0.0", first.Runtime);
        Assert.Equal(48, first.MeanMicroseconds);
        Assert.Equal(100, first.Iterations);
        Assert.True(File.Exists(journal.DatabasePath));
    }

    [Fact]
    public async Task Survives_a_new_instance_and_can_be_cleared()
    {
        var ct = TestContext.Current.CancellationToken;
        using var dir = new TempDirectory();
        var path = Path.Combine(dir.Path, "journal.db");
        await new PerformanceJournal(path).RecordAsync(Run("persisted", DateTimeOffset.UtcNow, ("x", 1)), ct);

        var reopened = new PerformanceJournal(path);
        Assert.Equal("persisted", (await reopened.GetRecentAsync(5, cancellationToken: ct)).Single().RunId);

        await reopened.ClearAsync(ct);
        Assert.Equal(0, await reopened.CountAsync(ct));
    }

    [Fact]
    public async Task Reading_a_missing_journal_does_not_create_it()
    {
        var ct = TestContext.Current.CancellationToken;
        using var dir = new TempDirectory();
        var journal = new PerformanceJournal(Path.Combine(dir.Path, "App_Data", "journal.db"));

        Assert.Empty(await journal.GetRecentAsync(10, cancellationToken: ct));
        Assert.Equal(0, await journal.CountAsync(ct));
        await journal.ClearAsync(ct);

        Assert.False(journal.Exists);
        Assert.False(Directory.Exists(Path.Combine(dir.Path, "App_Data")));
    }

    [Fact]
    public async Task Filters_by_group_and_clamps_the_limit()
    {
        var ct = TestContext.Current.CancellationToken;
        using var dir = new TempDirectory();
        var journal = new PerformanceJournal(Path.Combine(dir.Path, "journal.db"));
        await journal.RecordAsync(Run("r", DateTimeOffset.UtcNow, ("a", 1), ("b", 2), ("c", 3)), ct);

        Assert.Single(await journal.GetRecentAsync(0, cancellationToken: ct)); // clamped up to 1
        Assert.Equal(3, (await journal.GetRecentAsync(10, "parse", ct)).Count);
        Assert.Empty(await journal.GetRecentAsync(10, "other", ct));
    }
}
