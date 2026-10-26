using MetroSim.Core.Engine;
using MetroSim.Persistence;
using MetroSim.Tests.Support;
using Microsoft.Data.Sqlite;

namespace MetroSim.Tests.Persistence;

public sealed class SaveGameTests
{
    private static string SavedDemo(out Simulation sim, int days = 2)
    {
        sim = new DemoRun().Days(days).Sim;
        string path = TestWorld.TempPath("city.city");
        SaveGameStore.Save(sim, path, "Testville");
        return path;
    }

    private static void Sql(string path, string sql)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        connection.Open();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    [Fact]
    public void SaveLoad_RoundTripsTheWholeState()
    {
        string path = SavedDemo(out var sim);
        var loaded = SaveGameStore.Load(path);
        Assert.Equal(sim.ComputeStateHash(), loaded.ComputeStateHash());
        Assert.Equal(sim.Stats.Population, loaded.Stats.Population);
        Assert.Equal(sim.Budget.Money, loaded.Budget.Money);
        Assert.Equal(sim.Traffic.Vehicles.Count, loaded.Traffic.Vehicles.Count);
        Assert.Equal(sim.CommandLog.Count, loaded.CommandLog.Count);
        Invariants.Check(loaded);
    }

    [Fact]
    public void ReadSummary_DescribesTheSaveWithoutLoading()
    {
        string path = SavedDemo(out var sim);
        var summary = SaveGameStore.ReadSummary(path);
        Assert.Equal("Testville", summary.CityName);
        Assert.Equal(SaveGameStore.FormatVersion, summary.FormatVersion);
        Assert.Equal(42UL, summary.Seed);
        Assert.Equal(sim.Tick, summary.Tick);
        Assert.Equal(sim.Stats.Population, summary.Population);
        Assert.Equal(sim.Budget.Money, summary.Money);
        Assert.Equal(sim.ComputeStateHash(), summary.StateHash);
    }

    [Fact]
    public void Save_OverwritesAtomically_AndLeavesNoTempFiles()
    {
        string path = SavedDemo(out var sim);
        sim.Run(600);
        SaveGameStore.Save(sim, path);
        Assert.Equal(sim.Tick, SaveGameStore.ReadSummary(path).Tick);
        Assert.Single(Directory.GetFiles(Path.GetDirectoryName(path)!));
    }

    [Fact]
    public void Load_FlippedByteInChunk_IsRejected()
    {
        string path = SavedDemo(out _);
        using (var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString()))
        {
            connection.Open();
            using var read = connection.CreateCommand();
            read.CommandText = "SELECT data FROM chunks WHERE name = 'citizens'";
            byte[] data = (byte[])read.ExecuteScalar()!;
            data[data.Length / 2] ^= 0x01;
            using var write = connection.CreateCommand();
            write.CommandText = "UPDATE chunks SET data = $d WHERE name = 'citizens'";
            write.Parameters.AddWithValue("$d", data);
            write.ExecuteNonQuery();
        }

        var ex = Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
        Assert.Contains("citizens", ex.Message);
    }

    [Fact]
    public void Load_ConsistentlyTamperedChunk_FailsTheStateFingerprint()
    {
        string path = SavedDemo(out var sim);
        // Rewrite the economy chunk with a valid one from a different city, updating its own checksum.
        var other = new DemoRun(seed: 7).Days(1).Sim;
        var chunk = MetroSim.Core.Serialization.SimulationSerializer.Serialize(other).Single(c => c.Name == "economy");
        using (var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString()))
        {
            connection.Open();
            using var cmd = connection.CreateCommand();
            cmd.CommandText = "UPDATE chunks SET data = $d, length = $l, sha256 = $h WHERE name = 'economy'";
            cmd.Parameters.AddWithValue("$d", chunk.Data);
            cmd.Parameters.AddWithValue("$l", chunk.Data.Length);
            cmd.Parameters.AddWithValue("$h", MetroSim.Core.Serialization.SimulationSerializer.HashBytes(chunk.Data));
            cmd.ExecuteNonQuery();
        }

        var ex = Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
        Assert.Contains("fingerprint", ex.Message);
        _ = sim;
    }

    [Fact]
    public void Load_MissingChunk_IsRejected()
    {
        string path = SavedDemo(out _);
        Sql(path, "DELETE FROM chunks WHERE name = 'traffic'");
        Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
    }

    [Fact]
    public void Load_NewerFormat_IsRejectedWithClearMessage()
    {
        string path = SavedDemo(out _);
        Sql(path, "UPDATE meta SET value = '99' WHERE key = 'format_version'");
        var ex = Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
        Assert.Contains("newer version", ex.Message);
    }

    [Fact]
    public void Load_ForeignSqliteDatabase_IsRejected()
    {
        string path = TestWorld.TempPath("other.db");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        Sql(path, "CREATE TABLE x (a INTEGER)");
        var ex = Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
        Assert.Contains("not a MetroSim save", ex.Message);
    }

    [Fact]
    public void Load_RandomBytes_IsRejected()
    {
        string path = TestWorld.TempPath("garbage.city");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, Enumerable.Range(0, 5000).Select(i => (byte)(i * 7)).ToArray());
        Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
    }

    [Fact]
    public void Load_TruncatedFile_IsRejected()
    {
        string path = SavedDemo(out _);
        byte[] bytes = File.ReadAllBytes(path);
        File.WriteAllBytes(path, bytes[..(bytes.Length / 2)]);
        Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));
    }

    [Fact]
    public void Load_MissingFile_IsRejected()
    {
        var ex = Assert.Throws<SaveGameException>(() => SaveGameStore.Load(TestWorld.TempPath("nope.city")));
        Assert.Contains("not found", ex.Message);
    }

    [Fact]
    public void Save_FreshEmptyCity_RoundTrips()
    {
        var sim = TestWorld.Flat(40);
        string path = TestWorld.TempPath("empty.city");
        SaveGameStore.Save(sim, path);
        Assert.Equal(sim.ComputeStateHash(), SaveGameStore.Load(path).ComputeStateHash());
    }

    [Fact]
    public void Verify_ReplayFromSave_MatchesRecordedState()
    {
        string path = SavedDemo(out _, days: 3);
        var loaded = SaveGameStore.Load(path);
        var replay = ReplayVerifier.Replay(loaded);
        Assert.True(replay.Matches);
    }
}
