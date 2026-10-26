using System.Buffers.Binary;
using MetroSim.Core.Engine;
using MetroSim.Core.Serialization;
using MetroSim.Core.World;
using MetroSim.Persistence;
using MetroSim.Tests.Support;
using Microsoft.Data.Sqlite;

namespace MetroSim.Tests.Persistence;

/// <summary>
/// Saves edited by someone who also recomputes every checksum and the state fingerprint. Integrity
/// hashes cannot catch these; the deserializer's own validation must reject them with a
/// <see cref="SaveGameException"/>, quickly, and without large allocations.
/// </summary>
public sealed class HostileSaveTests
{
    private static string Save(Simulation sim)
    {
        string path = TestWorld.TempPath("hostile.city");
        SaveGameStore.Save(sim, path);
        return path;
    }

    private static SqliteConnection Open(string path)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Pooling = false }.ToString());
        connection.Open();
        return connection;
    }

    private static void Sql(string path, string sql)
    {
        using var connection = Open(path);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    /// <summary>Rewrites one chunk and re-seals its checksum and the whole-state fingerprint.</summary>
    private static void Reseal(string path, string chunk, Func<byte[], byte[]> edit)
    {
        var (_, chunks) = SaveGameStore.ReadValidated(path);
        var edited = chunks.Select(c => c.Name == chunk ? c with { Data = edit(c.Data) } : c).ToList();
        var data = edited.Single(c => c.Name == chunk).Data;
        using var connection = Open(path);
        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "UPDATE chunks SET data = $d, length = $l, sha256 = $h WHERE name = $n";
            cmd.Parameters.AddWithValue("$d", data);
            cmd.Parameters.AddWithValue("$l", data.Length);
            cmd.Parameters.AddWithValue("$h", SimulationSerializer.HashBytes(data));
            cmd.Parameters.AddWithValue("$n", chunk);
            cmd.ExecuteNonQuery();
        }

        using (var cmd = connection.CreateCommand())
        {
            cmd.CommandText = "UPDATE meta SET value = $h WHERE key = 'state_hash'";
            cmd.Parameters.AddWithValue("$h", SimulationSerializer.HashChunks(edited));
            cmd.ExecuteNonQuery();
        }
    }

    private static SaveGameException Rejected(string path) => Assert.Throws<SaveGameException>(() => SaveGameStore.Load(path));

    [Fact]
    public void HugeEntityTableHeader_IsRejectedWithoutAllocating()
    {
        string path = Save(new DemoRun().Days(1).Sim);
        Reseal(path, "citizens", _ =>
        {
            var header = new byte[12];
            BinaryPrimitives.WriteInt32LittleEndian(header, 2_000_000_000);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(4), 0);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(8), 1_999_999_999);
            return header;
        });
        long before = GC.GetAllocatedBytesForCurrentThread();
        Rejected(path);
        Assert.True(GC.GetAllocatedBytesForCurrentThread() - before < 64 * 1024 * 1024);
    }

    [Fact]
    public void FreeListContainingALiveId_IsRejected()
    {
        string path = Save(new DemoRun().Days(1).Sim);
        Reseal(path, "citizens", data =>
        {
            int highWater = BinaryPrimitives.ReadInt32LittleEndian(data);
            int freeCount = BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(4));
            int afterFree = 8 + freeCount * 4;
            int count = BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(afterFree));
            int firstLiveId = BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(afterFree + 4));
            using var stream = new MemoryStream();
            using var w = new BinaryWriter(stream);
            w.Write(highWater + 1);
            w.Write(freeCount + 1);
            w.Write(data, 8, freeCount * 4);
            w.Write(firstLiveId);
            w.Write(count);
            w.Write(data, afterFree + 4, data.Length - afterFree - 4);
            return stream.ToArray();
        });
        Rejected(path);
    }

    [Fact]
    public void AbsurdTick_IsRejected()
    {
        string path = Save(TestWorld.Flat(40));
        // Tick sits after width, height, seed, three doubles, rivers, feature scale and water level.
        Reseal(path, "world", data =>
        {
            BinaryPrimitives.WriteInt64LittleEndian(data.AsSpan(56), 1_000_000_000_000_000);
            return data;
        });
        Assert.Contains("tick", Rejected(path).Message);
    }

    [Fact]
    public void InvalidCommandInLog_IsRejectedOnLoad()
    {
        var sim = TestWorld.Flat(40);
        sim.Execute(new SetTaxCommand(ZoneType.Residential, 10));
        string path = Save(sim);
        Reseal(path, "commands", data =>
        {
            data[^5] = 9; // the zone byte of the single SetTax command
            return data;
        });
        Rejected(path);
    }

    [Fact]
    public void NonCanonicalEncoding_FailsThePostLoadFingerprint()
    {
        var sim = TestWorld.Flat(40);
        string path = Save(sim);
        int n = sim.Map.TileCount;
        // A boolean stored as 2 reads back as true but re-serializes as 1.
        Reseal(path, "world", data =>
        {
            data[64 + 5 * n] = 2;
            return data;
        });
        Assert.Contains("fingerprint", Rejected(path).Message);
    }

    [Fact]
    public void OccupancyThatDisagreesWithCitizens_IsRejected()
    {
        var sim = new DemoRun().Days(2).Sim;
        var home = sim.Buildings.First(b => b.Residents > 0);
        home.Residents++;
        string path = Save(sim);
        Assert.Contains("occupancy", Rejected(path).Message);
    }

    [Theory]
    [InlineData("UPDATE meta SET value = '99999999999' WHERE key = 'map_width'")]
    [InlineData("UPDATE meta SET value = 'abc' WHERE key = 'tick'")]
    [InlineData("UPDATE meta SET value = '-1' WHERE key = 'population'")]
    [InlineData("UPDATE meta SET value = '0' WHERE key = 'format_version'")]
    [InlineData("UPDATE meta SET value = 'x' WHERE key = 'seed'")]
    [InlineData("UPDATE chunks SET version = 99999999999 WHERE name = 'rng'")]
    [InlineData("UPDATE chunks SET data = 'text, not a blob' WHERE name = 'rng'")]
    [InlineData("PRAGMA user_version = 7")]
    public void MalformedContainerValues_AreRejectedAsSaveErrors(string sql)
    {
        string path = Save(TestWorld.Flat(40));
        Sql(path, sql);
        Rejected(path);
    }

    [Fact]
    public void NonDefaultRoutingSettings_SurviveSaveAndReplay()
    {
        var run = new DemoRun();
        run.Sim.Pathfinder.HeuristicWeightPercent = 100;
        run.Days(2);
        string path = Save(run.Sim);
        var loaded = SaveGameStore.Load(path);
        Assert.Equal(100, loaded.Pathfinder.HeuristicWeightPercent);
        loaded.RunDays(1);
        run.Sim.RunDays(1);
        Assert.Equal(run.Sim.ComputeStateHash(), loaded.ComputeStateHash());
    }
}
