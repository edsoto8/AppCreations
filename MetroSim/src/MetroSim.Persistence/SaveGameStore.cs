using System.Globalization;
using MetroSim.Core.Engine;
using MetroSim.Core.Serialization;
using Microsoft.Data.Sqlite;

namespace MetroSim.Persistence;

public sealed class SaveGameException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>What a save contains, readable without loading the city.</summary>
public sealed record SaveSummary(
    string Path,
    int FormatVersion,
    string CityName,
    ulong Seed,
    int MapWidth,
    int MapHeight,
    long Tick,
    int Population,
    long Money,
    DateTime SavedUtc,
    string StateHash);

/// <summary>
/// Save files are SQLite databases: a <c>meta</c> key/value table and a <c>chunks</c> table of
/// versioned binary blobs, each with its own SHA-256. Writes go to a temporary file that is renamed
/// over the target only after it is complete, so a crash never leaves a half-written save.
/// </summary>
public static class SaveGameStore
{
    /// <summary>Container format version. Bump it (and add a migration) when the table layout changes.</summary>
    public const int FormatVersion = 1;

    public const string FileExtension = ".city";

    /// <summary>SQLite application_id 'MSIM', so other databases are rejected up front.</summary>
    public const int ApplicationId = 0x4D53494D;

    public static void Save(Simulation sim, string path, string cityName = "MetroSim City")
    {
        ArgumentNullException.ThrowIfNull(sim);
        string full = Path.GetFullPath(path);
        string? directory = Path.GetDirectoryName(full);
        if (directory is not null)
        {
            Directory.CreateDirectory(directory);
        }

        var chunks = SimulationSerializer.Serialize(sim);
        string stateHash = SimulationSerializer.HashChunks(chunks);
        string temp = full + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            using (var connection = Open(temp, SqliteOpenMode.ReadWriteCreate))
            {
                Execute(connection, $"PRAGMA application_id = {ApplicationId};");
                Execute(connection, $"PRAGMA user_version = {FormatVersion};");
                Execute(connection, """
                    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                    CREATE TABLE chunks (
                        name TEXT PRIMARY KEY,
                        version INTEGER NOT NULL,
                        length INTEGER NOT NULL,
                        sha256 TEXT NOT NULL,
                        data BLOB NOT NULL);
                    """);
                using var tx = connection.BeginTransaction();
                var meta = new Dictionary<string, string>
                {
                    ["format_version"] = FormatVersion.ToString(CultureInfo.InvariantCulture),
                    ["city_name"] = cityName,
                    ["seed"] = sim.Settings.Seed.ToString(CultureInfo.InvariantCulture),
                    ["map_width"] = sim.Map.Width.ToString(CultureInfo.InvariantCulture),
                    ["map_height"] = sim.Map.Height.ToString(CultureInfo.InvariantCulture),
                    ["tick"] = sim.Tick.ToString(CultureInfo.InvariantCulture),
                    ["population"] = sim.Stats.Population.ToString(CultureInfo.InvariantCulture),
                    ["money"] = sim.Budget.Money.ToString(CultureInfo.InvariantCulture),
                    ["saved_utc"] = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture),
                    ["state_hash"] = stateHash,
                };
                foreach (var (key, value) in meta)
                {
                    using var cmd = connection.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO meta (key, value) VALUES ($k, $v)";
                    cmd.Parameters.AddWithValue("$k", key);
                    cmd.Parameters.AddWithValue("$v", value);
                    cmd.ExecuteNonQuery();
                }

                foreach (var chunk in chunks)
                {
                    using var cmd = connection.CreateCommand();
                    cmd.Transaction = tx;
                    cmd.CommandText = "INSERT INTO chunks (name, version, length, sha256, data) VALUES ($n, $v, $l, $h, $d)";
                    cmd.Parameters.AddWithValue("$n", chunk.Name);
                    cmd.Parameters.AddWithValue("$v", chunk.Version);
                    cmd.Parameters.AddWithValue("$l", chunk.Data.Length);
                    cmd.Parameters.AddWithValue("$h", SimulationSerializer.HashBytes(chunk.Data));
                    cmd.Parameters.AddWithValue("$d", chunk.Data);
                    cmd.ExecuteNonQuery();
                }

                tx.Commit();
            }

            File.Move(temp, full, overwrite: true);
        }
        catch (SqliteException ex)
        {
            throw new SaveGameException($"Could not write the save file: {ex.Message}", ex);
        }
        catch (IOException ex)
        {
            throw new SaveGameException($"Could not write the save file: {ex.Message}", ex);
        }
        finally
        {
            if (File.Exists(temp))
            {
                File.Delete(temp);
            }
        }
    }

    /// <summary>Loads and fully validates a save (container, chunk hashes, state hash).</summary>
    public static Simulation Load(string path)
    {
        var (summary, chunks) = ReadValidated(path);
        Simulation sim;
        try
        {
            sim = SimulationSerializer.Deserialize(chunks);
        }
        catch (SaveFormatException ex)
        {
            throw new SaveGameException($"The save is damaged: {ex.Message}", ex);
        }

        string rebuilt = sim.ComputeStateHash();
        if (!string.Equals(rebuilt, summary.StateHash, StringComparison.Ordinal))
        {
            throw new SaveGameException("The save is damaged: the loaded city does not match its recorded fingerprint.");
        }

        return sim;
    }

    public static SaveSummary ReadSummary(string path) => ReadValidated(path, verifyChunks: false).Summary;

    /// <summary>Container checks and per-chunk SHA-256 checks; returns the raw chunks.</summary>
    public static (SaveSummary Summary, IReadOnlyList<SaveChunk> Chunks) ReadValidated(string path, bool verifyChunks = true)
    {
        string full = Path.GetFullPath(path);
        if (!File.Exists(full))
        {
            throw new SaveGameException($"Save file not found: {path}");
        }

        try
        {
            using var connection = Open(full, SqliteOpenMode.ReadOnly);
            if (Scalar(connection, "PRAGMA application_id;") != ApplicationId)
            {
                throw new SaveGameException("This file is not a MetroSim save.");
            }

            using (var check = connection.CreateCommand())
            {
                check.CommandText = "PRAGMA quick_check;";
                string? result = check.ExecuteScalar() as string;
                if (!string.Equals(result, "ok", StringComparison.Ordinal))
                {
                    throw new SaveGameException($"The save file is corrupted ({result}).");
                }
            }

            var meta = new Dictionary<string, string>(StringComparer.Ordinal);
            using (var cmd = connection.CreateCommand())
            {
                cmd.CommandText = "SELECT key, value FROM meta";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    meta[reader.GetString(0)] = reader.GetString(1);
                }
            }

            int format = int.Parse(Get(meta, "format_version"), CultureInfo.InvariantCulture);
            if (format > FormatVersion)
            {
                throw new SaveGameException($"This save was made by a newer version (format {format}); this build reads up to format {FormatVersion}.");
            }

            var summary = new SaveSummary(
                full,
                format,
                Get(meta, "city_name"),
                ulong.Parse(Get(meta, "seed"), CultureInfo.InvariantCulture),
                int.Parse(Get(meta, "map_width"), CultureInfo.InvariantCulture),
                int.Parse(Get(meta, "map_height"), CultureInfo.InvariantCulture),
                long.Parse(Get(meta, "tick"), CultureInfo.InvariantCulture),
                int.Parse(Get(meta, "population"), CultureInfo.InvariantCulture),
                long.Parse(Get(meta, "money"), CultureInfo.InvariantCulture),
                DateTime.Parse(Get(meta, "saved_utc"), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
                Get(meta, "state_hash"));

            var chunks = new List<SaveChunk>();
            if (verifyChunks)
            {
                using var cmd = connection.CreateCommand();
                cmd.CommandText = "SELECT name, version, length, sha256, data FROM chunks ORDER BY name";
                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    string name = reader.GetString(0);
                    int version = reader.GetInt32(1);
                    long length = reader.GetInt64(2);
                    string sha = reader.GetString(3);
                    byte[] data = (byte[])reader["data"];
                    if (data.Length != length)
                    {
                        throw new SaveGameException($"The save is damaged: chunk '{name}' has the wrong length.");
                    }

                    if (!string.Equals(SimulationSerializer.HashBytes(data), sha, StringComparison.Ordinal))
                    {
                        throw new SaveGameException($"The save is damaged: chunk '{name}' failed its checksum.");
                    }

                    chunks.Add(new SaveChunk(name, version, data));
                }

                if (!string.Equals(SimulationSerializer.HashChunks(chunks), summary.StateHash, StringComparison.Ordinal))
                {
                    throw new SaveGameException("The save is damaged: chunks do not match the recorded fingerprint.");
                }
            }

            return (summary, chunks);
        }
        catch (SqliteException ex)
        {
            throw new SaveGameException($"Could not read the save file: {ex.Message}", ex);
        }
        catch (FormatException ex)
        {
            throw new SaveGameException($"The save's metadata is damaged: {ex.Message}", ex);
        }
    }

    private static string Get(Dictionary<string, string> meta, string key) =>
        meta.TryGetValue(key, out var value) ? value : throw new SaveGameException($"The save's metadata is missing '{key}'.");

    private static SqliteConnection Open(string path, SqliteOpenMode mode)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = mode,
            Pooling = false,
        };
        var connection = new SqliteConnection(builder.ToString());
        connection.Open();
        return connection;
    }

    private static void Execute(SqliteConnection connection, string sql)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static long Scalar(SqliteConnection connection, string sql)
    {
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }
}
