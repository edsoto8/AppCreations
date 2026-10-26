using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using MetroSim.Core.Buildings;
using MetroSim.Core.Citizens;
using MetroSim.Core.Economy;
using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.Traffic;
using MetroSim.Core.World;

namespace MetroSim.Core.Serialization;

/// <summary>A named, versioned block of serialized state.</summary>
public sealed record SaveChunk(string Name, int Version, byte[] Data);

public sealed class SaveFormatException(string message) : Exception(message);

/// <summary>
/// Binary snapshot of every piece of simulation state, split into chunks. Little-endian, exact
/// (doubles are written bit-for-bit), and independent of culture and platform. Derived data
/// (building tile map, lane occupancy, road graph) is rebuilt on load.
/// </summary>
public static class SimulationSerializer
{
    public const int CurrentChunkVersion = 1;

    /// <summary>About 2,000 in-game years; also keeps <see cref="Simulation.Day"/> within an int.</summary>
    public const long MaxTick = 1_000_000L * Simulation.TicksPerDay;

    public static readonly string[] ChunkOrder =
        ["world", "rng", "buildings", "citizens", "traffic", "economy", "stats", "commands"];

    public static IReadOnlyList<SaveChunk> Serialize(Simulation sim) =>
    [
        Chunk("world", w => WriteWorld(w, sim)),
        Chunk("rng", w => WriteRng(w, sim.Rng)),
        Chunk("buildings", w => WriteBuildings(w, sim.Buildings)),
        Chunk("citizens", w => WriteCitizens(w, sim.Citizens)),
        Chunk("traffic", w => WriteTraffic(w, sim.Traffic)),
        Chunk("economy", w => WriteEconomy(w, sim.Budget)),
        Chunk("stats", w => WriteStats(w, sim)),
        Chunk("commands", w => WriteCommands(w, sim.CommandLog)),
    ];

    public static string ComputeHash(Simulation sim) => HashChunks(Serialize(sim));

    /// <summary>SHA-256 over chunk names, versions and data, in <see cref="ChunkOrder"/>.</summary>
    public static string HashChunks(IEnumerable<SaveChunk> chunks)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Span<byte> header = stackalloc byte[8];
        foreach (var chunk in chunks.OrderBy(c => Array.IndexOf(ChunkOrder, c.Name)))
        {
            hash.AppendData(Encoding.UTF8.GetBytes(chunk.Name));
            BinaryPrimitives.WriteInt32LittleEndian(header, chunk.Version);
            BinaryPrimitives.WriteInt32LittleEndian(header[4..], chunk.Data.Length);
            hash.AppendData(header);
            hash.AppendData(chunk.Data);
        }

        return Convert.ToHexString(hash.GetHashAndReset());
    }

    public static string HashBytes(byte[] data) => Convert.ToHexString(SHA256.HashData(data));

    public static Simulation Deserialize(IReadOnlyList<SaveChunk> chunks)
    {
        var byName = new Dictionary<string, SaveChunk>(StringComparer.Ordinal);
        foreach (var c in chunks)
        {
            if (c.Version > CurrentChunkVersion)
            {
                throw new SaveFormatException($"Chunk '{c.Name}' is version {c.Version}; this build reads up to {CurrentChunkVersion}.");
            }

            byName[c.Name] = c;
        }

        foreach (string name in ChunkOrder)
        {
            if (!byName.ContainsKey(name))
            {
                throw new SaveFormatException($"Save is missing the '{name}' chunk.");
            }
        }

        try
        {
            var world = Reader(byName["world"]);
            var (settings, map, waterLevel, tick) = ReadWorld(world);
            var rng = ReadRng(Reader(byName["rng"]));
            var sim = new Simulation(settings, map, rng) { WaterLevel = waterLevel, Tick = tick };
            ReadBuildings(Reader(byName["buildings"]), sim);
            ReadCitizens(Reader(byName["citizens"]), sim.Citizens);
            ReadTraffic(Reader(byName["traffic"]), sim.Traffic);
            ReadEconomy(Reader(byName["economy"]), sim.Budget);
            ReadStats(Reader(byName["stats"]), sim);
            ReadCommands(Reader(byName["commands"]), sim.CommandLog);
            ValidateReferences(sim);
            sim.Traffic.RebuildOccupancy();
            map.TouchTerrain();
            map.TouchRoads();
            return sim;
        }
        catch (EndOfStreamException)
        {
            throw new SaveFormatException("Save data is truncated.");
        }
        catch (IOException ex)
        {
            throw new SaveFormatException($"Save data is malformed: {ex.Message}");
        }
        catch (FormatException ex)
        {
            throw new SaveFormatException($"Save data is malformed: {ex.Message}");
        }
        catch (OverflowException)
        {
            throw new SaveFormatException("Save data is malformed: a value is out of range.");
        }
        catch (ArgumentException ex)
        {
            throw new SaveFormatException($"Save data is inconsistent: {ex.Message}");
        }
        catch (IndexOutOfRangeException)
        {
            throw new SaveFormatException("Save data is inconsistent: an index is out of range.");
        }
    }

    private static SaveChunk Chunk(string name, Action<BinaryWriter> write)
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, Encoding.UTF8, leaveOpen: true))
        {
            write(writer);
        }

        return new SaveChunk(name, CurrentChunkVersion, stream.ToArray());
    }

    private static BinaryReader Reader(SaveChunk chunk) => new(new MemoryStream(chunk.Data, writable: false), Encoding.UTF8);

    // ---- world ----

    private static void WriteWorld(BinaryWriter w, Simulation sim)
    {
        var s = sim.Settings;
        w.Write(s.Width);
        w.Write(s.Height);
        w.Write(s.Seed);
        w.Write(s.WaterCoverage);
        w.Write(s.RockCoverage);
        w.Write(s.TreeCoverage);
        w.Write(s.Rivers);
        w.Write(s.FeatureScale);
        w.Write(sim.WaterLevel);
        w.Write(sim.Tick);
        var map = sim.Map;
        w.Write(map.Elevation);
        WriteEnumBytes(w, map.Terrain);
        w.Write(map.Trees);
        WriteEnumBytes(w, map.Roads);
        WriteEnumBytes(w, map.Zones);
        foreach (bool line in map.PowerLines)
        {
            w.Write(line);
        }

        w.Write(map.Pollution);
        w.Write(map.LandValue);
    }

    private static (MapSettings, CityMap, int, long) ReadWorld(BinaryReader r)
    {
        var settings = new MapSettings
        {
            Width = r.ReadInt32(),
            Height = r.ReadInt32(),
            Seed = r.ReadUInt64(),
            WaterCoverage = r.ReadDouble(),
            RockCoverage = r.ReadDouble(),
            TreeCoverage = r.ReadDouble(),
            Rivers = r.ReadInt32(),
            FeatureScale = r.ReadDouble(),
        };
        try
        {
            settings.Validate();
        }
        catch (ArgumentException ex)
        {
            throw new SaveFormatException($"Invalid map settings: {ex.Message}");
        }

        int waterLevel = r.ReadInt32();
        long tick = r.ReadInt64();
        if (tick < 0 || tick > MaxTick)
        {
            throw new SaveFormatException("Invalid tick.");
        }

        var map = new CityMap(settings.Width, settings.Height);
        int n = map.TileCount;
        ReadExact(r, map.Elevation);
        for (int i = 0; i < n; i++)
        {
            map.Terrain[i] = CheckedEnum<TerrainType>(r.ReadByte(), 3);
        }

        ReadExact(r, map.Trees);
        for (int i = 0; i < n; i++)
        {
            map.Roads[i] = CheckedEnum<RoadType>(r.ReadByte(), 2);
        }

        for (int i = 0; i < n; i++)
        {
            map.Zones[i] = CheckedEnum<ZoneType>(r.ReadByte(), 3);
        }

        for (int i = 0; i < n; i++)
        {
            map.PowerLines[i] = r.ReadBoolean();
        }

        ReadExact(r, map.Pollution);
        ReadExact(r, map.LandValue);
        return (settings, map, waterLevel, tick);
    }

    // ---- rng ----

    private static void WriteRng(BinaryWriter w, RngSet rng)
    {
        foreach (var g in new[] { rng.Growth, rng.Citizens, rng.Events })
        {
            w.Write(g.State);
            w.Write(g.Increment);
        }
    }

    private static RngSet ReadRng(BinaryReader r)
    {
        Pcg32 Next() => Pcg32.FromState(r.ReadUInt64(), r.ReadUInt64());
        return new RngSet(Next(), Next(), Next());
    }

    // ---- entity stores ----

    private static void WriteStoreHeader<T>(BinaryWriter w, EntityStore<T> store) where T : class, IEntity
    {
        w.Write(store.HighWater);
        w.Write(store.FreeIds.Count);
        foreach (int id in store.FreeIds)
        {
            w.Write(id);
        }

        w.Write(store.Count);
    }

    private static (int HighWater, int[] Free, int Count) ReadStoreHeader(BinaryReader r)
    {
        int highWater = r.ReadInt32();
        int freeCount = r.ReadInt32();
        // Every live record and every free id takes at least 4 bytes, so a header can never claim more
        // entries than the chunk has bytes left; this bounds allocations for hostile input.
        long remaining = r.BaseStream.Length - r.BaseStream.Position;
        if (highWater < 1 || freeCount < 0 || freeCount > highWater || highWater - 1L > remaining / 4)
        {
            throw new SaveFormatException("Invalid entity table header.");
        }

        var free = new int[freeCount];
        for (int i = 0; i < freeCount; i++)
        {
            free[i] = r.ReadInt32();
            if (free[i] < 1 || free[i] >= highWater)
            {
                throw new SaveFormatException("Invalid free id.");
            }
        }

        int count = r.ReadInt32();
        if (count < 0 || (long)count + freeCount != highWater - 1L)
        {
            throw new SaveFormatException("Entity table counts do not add up.");
        }

        return (highWater, free, count);
    }

    private static int ReadId(BinaryReader r, int highWater)
    {
        int id = r.ReadInt32();
        if (id < 1 || id >= highWater)
        {
            throw new SaveFormatException("Entity id out of range.");
        }

        return id;
    }

    private static void WriteBuildings(BinaryWriter w, EntityStore<Building> store)
    {
        WriteStoreHeader(w, store);
        foreach (var b in store)
        {
            w.Write(b.Id);
            w.Write((byte)b.Kind);
            w.Write(b.X);
            w.Write(b.Y);
            w.Write(b.Size);
            w.Write(b.Level);
            w.Write(b.AccessTile);
            w.Write(b.ConstructionHours);
            w.Write(b.Powered);
            w.Write(b.Watered);
            w.Write(b.CoveredByFire);
            w.Write(b.CoveredByHealth);
            w.Write(b.CoveredByGarbage);
            w.Write(b.Garbage);
            w.Write(b.Stored);
            w.Write(b.Residents);
            w.Write(b.Workers);
            w.Write(b.CustomersToday);
            w.Write(b.CustomersYesterday);
            w.Write(b.DaysUnpowered);
            w.Write(b.DaysNoWater);
            w.Write(b.DaysNoAccess);
            w.Write(b.DaysGarbage);
            w.Write(b.DaysNoWorkers);
            w.Write(b.GoodDays);
            w.Write(b.Abandoned);
            w.Write(b.AbandonedDays);
            w.Write(b.FireDamage);
            w.Write(b.FireTruckId);
            w.Write(b.FireStationId);
            w.Write(b.ExtinguishTicks);
            w.Write(b.TrucksOut);
            w.Write(b.PowerProduced);
        }
    }

    private static void ReadBuildings(BinaryReader r, Simulation sim)
    {
        var (highWater, free, count) = ReadStoreHeader(r);
        var map = sim.Map;
        var items = new List<Building>(Math.Min(count, 4096));
        for (int i = 0; i < count; i++)
        {
            var b = new Building
            {
                Id = ReadId(r, highWater),
                Kind = CheckedEnum<BuildingKind>(r.ReadByte(), (int)BuildingKind.Clinic),
                X = r.ReadInt32(),
                Y = r.ReadInt32(),
                Size = r.ReadInt32(),
                Level = r.ReadInt32(),
                AccessTile = r.ReadInt32(),
                ConstructionHours = r.ReadInt32(),
                Powered = r.ReadBoolean(),
                Watered = r.ReadBoolean(),
                CoveredByFire = r.ReadBoolean(),
                CoveredByHealth = r.ReadBoolean(),
                CoveredByGarbage = r.ReadBoolean(),
                Garbage = r.ReadInt32(),
                Stored = r.ReadInt32(),
                Residents = r.ReadInt32(),
                Workers = r.ReadInt32(),
                CustomersToday = r.ReadInt32(),
                CustomersYesterday = r.ReadInt32(),
                DaysUnpowered = r.ReadInt32(),
                DaysNoWater = r.ReadInt32(),
                DaysNoAccess = r.ReadInt32(),
                DaysGarbage = r.ReadInt32(),
                DaysNoWorkers = r.ReadInt32(),
                GoodDays = r.ReadInt32(),
                Abandoned = r.ReadBoolean(),
                AbandonedDays = r.ReadInt32(),
                FireDamage = r.ReadInt32(),
                FireTruckId = r.ReadInt32(),
                FireStationId = r.ReadInt32(),
                ExtinguishTicks = r.ReadInt32(),
                TrucksOut = r.ReadInt32(),
                PowerProduced = r.ReadInt32(),
            };
            if (b.Size != b.Spec.Size || b.Level is < 1 or > ZoneLevels.MaxLevel || !map.InBounds(b.X, b.Y)
                || !map.InBounds(b.X + b.Size - 1, b.Y + b.Size - 1) || b.AccessTile < -1 || b.AccessTile >= map.TileCount)
            {
                throw new SaveFormatException($"Building {b.Id} has invalid geometry or level.");
            }

            for (int ty = b.Y; ty < b.Y + b.Size; ty++)
            {
                for (int tx = b.X; tx < b.X + b.Size; tx++)
                {
                    int t = map.Index(tx, ty);
                    if (map.BuildingAt[t] != 0)
                    {
                        throw new SaveFormatException($"Buildings {map.BuildingAt[t]} and {b.Id} overlap.");
                    }

                    map.BuildingAt[t] = b.Id;
                }
            }

            items.Add(b);
        }

        sim.Buildings.Restore(highWater, items, free);
    }

    private static void WriteCitizens(BinaryWriter w, EntityStore<Citizen> store)
    {
        WriteStoreHeader(w, store);
        foreach (var c in store)
        {
            w.Write(c.Id);
            w.Write(c.HomeId);
            w.Write(c.JobId);
            w.Write(c.Age);
            w.Write((byte)c.State);
            w.Write(c.WorkStart);
            w.Write(c.ShopMinute);
            w.Write(c.ShopId);
            w.Write(c.ActivityEnd);
            w.Write(c.VehicleId);
            w.Write(c.Satisfaction);
            w.Write(c.DaysUnemployed);
            w.Write(c.UnhappyDays);
            w.Write(c.LastCommuteMinutes);
            w.Write(c.FailedCommutes);
        }
    }

    private static void ReadCitizens(BinaryReader r, EntityStore<Citizen> store)
    {
        var (highWater, free, count) = ReadStoreHeader(r);
        var items = new List<Citizen>(Math.Min(count, 4096));
        for (int i = 0; i < count; i++)
        {
            items.Add(new Citizen
            {
                Id = ReadId(r, highWater),
                HomeId = r.ReadInt32(),
                JobId = r.ReadInt32(),
                Age = r.ReadInt32(),
                State = CheckedEnum<CitizenState>(r.ReadByte(), (int)CitizenState.AtShop),
                WorkStart = r.ReadInt32(),
                ShopMinute = r.ReadInt32(),
                ShopId = r.ReadInt32(),
                ActivityEnd = r.ReadInt64(),
                VehicleId = r.ReadInt32(),
                Satisfaction = r.ReadInt32(),
                DaysUnemployed = r.ReadInt32(),
                UnhappyDays = r.ReadInt32(),
                LastCommuteMinutes = r.ReadInt32(),
                FailedCommutes = r.ReadInt32(),
            });
        }

        store.Restore(highWater, items, free);
    }

    // ---- traffic ----

    private static void WriteTraffic(BinaryWriter w, TrafficSystem traffic)
    {
        w.Write(traffic.RerouteAfterTicks);
        w.Write(traffic.RerouteCooldownTicks);
        w.Write(traffic.RerouteBudgetPerTick);
        w.Write(traffic.WalkMaxTiles);
        w.Write(traffic.RerouteNodeLimit);
        w.Write(traffic.Pathfinder.NodeLimit);
        w.Write(traffic.Pathfinder.HeuristicWeightPercent);
        WriteStoreHeader(w, traffic.Vehicles);
        foreach (var v in traffic.Vehicles)
        {
            w.Write(v.Id);
            w.Write((byte)v.Kind);
            w.Write((byte)v.Purpose);
            w.Write(v.CitizenId);
            w.Write(v.OriginBuildingId);
            w.Write(v.TargetBuildingId);
            w.Write(v.Path.Length);
            foreach (int t in v.Path)
            {
                w.Write(t);
            }

            w.Write(v.PathIndex);
            w.Write(v.Progress);
            w.Write((byte)v.Lane);
            w.Write(v.InLane);
            w.Write(v.WaitTicks);
            w.Write(v.StartTick);
            w.Write(v.FreeFlowTicks);
            w.Write(v.LastRerouteTick);
            w.Write(v.Reroutes);
        }

        WriteInts(w, traffic.VolumeThisHour);
        WriteInts(w, traffic.VolumeLastHour);
        var m = traffic.Metrics;
        w.Write(m.TripsStarted);
        w.Write(m.TripsCompleted);
        w.Write(m.TripsAborted);
        w.Write(m.Reroutes);
        w.Write(m.CarTripsThisHour);
        w.Write(m.CarTripTicksThisHour);
        w.Write(m.CarFreeFlowTicksThisHour);
        w.Write(m.WalkTripsThisHour);
        w.Write(m.CarTripsLastHour);
        w.Write(m.WalkTripsLastHour);
        w.Write(m.AverageTripMinutesX10);
        w.Write(m.TravelTimeIndex);
    }

    private static void ReadTraffic(BinaryReader r, TrafficSystem traffic)
    {
        traffic.RerouteAfterTicks = r.ReadInt32();
        traffic.RerouteCooldownTicks = r.ReadInt32();
        traffic.RerouteBudgetPerTick = r.ReadInt32();
        traffic.WalkMaxTiles = r.ReadInt32();
        traffic.RerouteNodeLimit = r.ReadInt32();
        traffic.Pathfinder.NodeLimit = r.ReadInt32();
        traffic.Pathfinder.HeuristicWeightPercent = r.ReadInt32();
        if (traffic.RerouteAfterTicks < 1 || traffic.RerouteCooldownTicks < 0 || traffic.RerouteBudgetPerTick < 0
            || traffic.WalkMaxTiles < 0 || traffic.RerouteNodeLimit < 1 || traffic.Pathfinder.NodeLimit < 1
            || traffic.Pathfinder.HeuristicWeightPercent is < 100 or > 1000)
        {
            throw new SaveFormatException("Invalid traffic settings.");
        }

        var (highWater, free, count) = ReadStoreHeader(r);
        int tiles = traffic.VolumeThisHour.Length;
        var items = new List<Vehicle>(Math.Min(count, 4096));
        for (int i = 0; i < count; i++)
        {
            var v = new Vehicle
            {
                Id = ReadId(r, highWater),
                Kind = CheckedEnum<VehicleKind>(r.ReadByte(), (int)VehicleKind.FireTruck),
                Purpose = CheckedEnum<TripPurpose>(r.ReadByte(), (int)TripPurpose.FireReturn),
                CitizenId = r.ReadInt32(),
                OriginBuildingId = r.ReadInt32(),
                TargetBuildingId = r.ReadInt32(),
            };
            int length = r.ReadInt32();
            if (length < 2 || length > tiles)
            {
                throw new SaveFormatException($"Vehicle {v.Id} has an invalid path.");
            }

            var path = new int[length];
            for (int k = 0; k < length; k++)
            {
                path[k] = r.ReadInt32();
                if (path[k] < 0 || path[k] >= tiles)
                {
                    throw new SaveFormatException($"Vehicle {v.Id} path leaves the map.");
                }
            }

            v.Path = path;
            v.PathIndex = r.ReadInt32();
            if (v.PathIndex < 0 || v.PathIndex >= length - 1)
            {
                throw new SaveFormatException($"Vehicle {v.Id} has an invalid path position.");
            }

            v.Progress = r.ReadInt32();
            v.Lane = CheckedEnum<Direction>(r.ReadByte(), 3);
            v.InLane = r.ReadBoolean();
            v.WaitTicks = r.ReadInt32();
            v.StartTick = r.ReadInt64();
            v.FreeFlowTicks = r.ReadInt32();
            v.LastRerouteTick = r.ReadInt64();
            v.Reroutes = r.ReadInt32();
            items.Add(v);
        }

        traffic.Vehicles.Restore(highWater, items, free);
        ReadInts(r, traffic.VolumeThisHour);
        ReadInts(r, traffic.VolumeLastHour);
        var m = traffic.Metrics;
        m.TripsStarted = r.ReadInt64();
        m.TripsCompleted = r.ReadInt64();
        m.TripsAborted = r.ReadInt64();
        m.Reroutes = r.ReadInt64();
        m.CarTripsThisHour = r.ReadInt32();
        m.CarTripTicksThisHour = r.ReadInt64();
        m.CarFreeFlowTicksThisHour = r.ReadInt64();
        m.WalkTripsThisHour = r.ReadInt32();
        m.CarTripsLastHour = r.ReadInt32();
        m.WalkTripsLastHour = r.ReadInt32();
        m.AverageTripMinutesX10 = r.ReadInt32();
        m.TravelTimeIndex = r.ReadInt32();
    }

    // ---- economy ----

    private static void WriteEconomy(BinaryWriter w, Budget budget)
    {
        w.Write(budget.Money);
        w.Write(budget.ResidentialTax);
        w.Write(budget.CommercialTax);
        w.Write(budget.IndustrialTax);
        WriteLedger(w, budget.Today);
        w.Write(budget.History.Count);
        foreach (var l in budget.History)
        {
            WriteLedger(w, l);
        }
    }

    private static void ReadEconomy(BinaryReader r, Budget budget)
    {
        budget.Money = r.ReadInt64();
        budget.ResidentialTax = r.ReadInt32();
        budget.CommercialTax = r.ReadInt32();
        budget.IndustrialTax = r.ReadInt32();
        foreach (int tax in new[] { budget.ResidentialTax, budget.CommercialTax, budget.IndustrialTax })
        {
            if (tax is < Budget.MinTax or > Budget.MaxTax)
            {
                throw new SaveFormatException("Tax rate out of range.");
            }
        }

        budget.Today = ReadLedger(r);
        int count = r.ReadInt32();
        if (count < 0 || count > Budget.HistoryDays)
        {
            throw new SaveFormatException("Invalid budget history length.");
        }

        budget.History.Clear();
        for (int i = 0; i < count; i++)
        {
            budget.History.Add(ReadLedger(r));
        }
    }

    private static void WriteLedger(BinaryWriter w, DailyLedger l)
    {
        w.Write(l.Day);
        w.Write(l.ResidentialTax);
        w.Write(l.CommercialTax);
        w.Write(l.IndustrialTax);
        w.Write(l.RoadUpkeep);
        w.Write(l.PowerUpkeep);
        w.Write(l.WaterUpkeep);
        w.Write(l.GarbageUpkeep);
        w.Write(l.FireUpkeep);
        w.Write(l.HealthUpkeep);
        w.Write(l.Construction);
        w.Write(l.ClosingBalance);
    }

    private static DailyLedger ReadLedger(BinaryReader r) => new()
    {
        Day = r.ReadInt32(),
        ResidentialTax = r.ReadInt64(),
        CommercialTax = r.ReadInt64(),
        IndustrialTax = r.ReadInt64(),
        RoadUpkeep = r.ReadInt64(),
        PowerUpkeep = r.ReadInt64(),
        WaterUpkeep = r.ReadInt64(),
        GarbageUpkeep = r.ReadInt64(),
        FireUpkeep = r.ReadInt64(),
        HealthUpkeep = r.ReadInt64(),
        Construction = r.ReadInt64(),
        ClosingBalance = r.ReadInt64(),
    };

    // ---- stats, demand, history, events ----

    private static void WriteStats(BinaryWriter w, Simulation sim)
    {
        var s = sim.Stats;
        int[] ints =
        [
            s.Population, s.Children, s.WorkingAge, s.Seniors, s.Employed, s.Unemployed, s.CommercialJobs,
            s.IndustrialJobs, s.FilledJobs, s.ResidentialCapacity, s.ResidentialBuildings, s.CommercialBuildings,
            s.IndustrialBuildings, s.ServiceBuildings, s.AbandonedBuildings, s.UnderConstruction, s.BurningBuildings,
            s.AverageSatisfaction, s.AverageCommuteMinutes, s.PowerProduction, s.PowerDemand, s.PowerSupplied,
            s.UnpoweredBuildings, s.WaterCapacity, s.WaterDemand, s.WaterSupplied, s.UnwateredBuildings,
            s.UncollectedGarbage, s.LandfillUsedPercent, s.GarbageProducedPerDay, s.GarbageCapacityPerDay,
        ];
        w.Write(ints.Length);
        foreach (int v in ints)
        {
            w.Write(v);
        }

        w.Write(s.TotalBirths);
        w.Write(s.TotalDeaths);
        w.Write(s.TotalMovedIn);
        w.Write(s.TotalMovedOut);
        w.Write(s.BuildingsBurnedDown);
        w.Write(s.FiresExtinguished);
        w.Write(sim.Demand.Residential);
        w.Write(sim.Demand.Commercial);
        w.Write(sim.Demand.Industrial);

        w.Write(sim.History.Samples.Count);
        foreach (var h in sim.History.Samples)
        {
            w.Write(h.Tick);
            w.Write(h.Population);
            w.Write(h.Money);
            w.Write(h.Vehicles);
            w.Write(h.TravelTimeIndex);
            w.Write(h.CarTripsLastHour);
            w.Write(h.Employed);
            w.Write(h.Jobs);
            w.Write(h.Satisfaction);
        }

        w.Write(sim.Events.TotalCount);
        w.Write(sim.Events.Items.Count);
        foreach (var e in sim.Events.Items)
        {
            w.Write(e.Tick);
            w.Write((byte)e.Severity);
            w.Write(e.Message);
            w.Write(e.Tile);
        }
    }

    private static void ReadStats(BinaryReader r, Simulation sim)
    {
        var s = sim.Stats;
        int count = r.ReadInt32();
        if (count != 31)
        {
            throw new SaveFormatException("Unexpected statistics layout.");
        }

        var v = new int[count];
        for (int i = 0; i < count; i++)
        {
            v[i] = r.ReadInt32();
        }

        (s.Population, s.Children, s.WorkingAge, s.Seniors, s.Employed, s.Unemployed, s.CommercialJobs) =
            (v[0], v[1], v[2], v[3], v[4], v[5], v[6]);
        (s.IndustrialJobs, s.FilledJobs, s.ResidentialCapacity, s.ResidentialBuildings, s.CommercialBuildings) =
            (v[7], v[8], v[9], v[10], v[11]);
        (s.IndustrialBuildings, s.ServiceBuildings, s.AbandonedBuildings, s.UnderConstruction, s.BurningBuildings) =
            (v[12], v[13], v[14], v[15], v[16]);
        (s.AverageSatisfaction, s.AverageCommuteMinutes, s.PowerProduction, s.PowerDemand, s.PowerSupplied) =
            (v[17], v[18], v[19], v[20], v[21]);
        (s.UnpoweredBuildings, s.WaterCapacity, s.WaterDemand, s.WaterSupplied, s.UnwateredBuildings) =
            (v[22], v[23], v[24], v[25], v[26]);
        (s.UncollectedGarbage, s.LandfillUsedPercent, s.GarbageProducedPerDay, s.GarbageCapacityPerDay) =
            (v[27], v[28], v[29], v[30]);
        s.TotalBirths = r.ReadInt64();
        s.TotalDeaths = r.ReadInt64();
        s.TotalMovedIn = r.ReadInt64();
        s.TotalMovedOut = r.ReadInt64();
        s.BuildingsBurnedDown = r.ReadInt64();
        s.FiresExtinguished = r.ReadInt64();
        sim.Demand.Residential = r.ReadInt32();
        sim.Demand.Commercial = r.ReadInt32();
        sim.Demand.Industrial = r.ReadInt32();

        int samples = r.ReadInt32();
        if (samples < 0 || samples > StatsHistory.Capacity)
        {
            throw new SaveFormatException("Invalid history length.");
        }

        var history = new List<HourSample>(samples);
        for (int i = 0; i < samples; i++)
        {
            history.Add(new HourSample(r.ReadInt64(), r.ReadInt32(), r.ReadInt64(), r.ReadInt32(), r.ReadInt32(),
                r.ReadInt32(), r.ReadInt32(), r.ReadInt32(), r.ReadInt32()));
        }

        sim.History.Restore(history);
        long total = r.ReadInt64();
        int events = r.ReadInt32();
        if (events < 0 || events > EventLog.Capacity)
        {
            throw new SaveFormatException("Invalid event log length.");
        }

        var list = new List<CityEvent>(events);
        for (int i = 0; i < events; i++)
        {
            list.Add(new CityEvent(r.ReadInt64(), CheckedEnum<EventSeverity>(r.ReadByte(), 2), r.ReadString(), r.ReadInt32()));
        }

        sim.Events.Restore(list, total);
    }

    // ---- commands ----

    private static void WriteCommands(BinaryWriter w, List<LoggedCommand> log)
    {
        w.Write(log.Count);
        foreach (var entry in log)
        {
            w.Write(entry.Tick);
            CommandCodec.Write(w, entry.Command);
        }
    }

    private static void ReadCommands(BinaryReader r, List<LoggedCommand> log)
    {
        int count = r.ReadInt32();
        if (count < 0 || count > (r.BaseStream.Length - r.BaseStream.Position) / 9)
        {
            throw new SaveFormatException("Invalid command log length.");
        }

        log.Clear();
        for (int i = 0; i < count; i++)
        {
            log.Add(new LoggedCommand(r.ReadInt64(), CommandCodec.Read(r)));
        }
    }

    // ---- cross-reference validation ----

    /// <summary>
    /// Rejects saves whose entities disagree with each other (a checksum only proves the bytes are the
    /// ones written, not that they describe a consistent city).
    /// </summary>
    private static void ValidateReferences(Simulation sim)
    {
        var residents = new Dictionary<int, int>();
        var workers = new Dictionary<int, int>();
        foreach (var c in sim.Citizens)
        {
            if (sim.Buildings[c.HomeId] is not { Kind: BuildingKind.Residential })
            {
                throw new SaveFormatException($"Citizen {c.Id} has no valid home.");
            }

            residents[c.HomeId] = residents.GetValueOrDefault(c.HomeId) + 1;
            if (c.JobId != 0)
            {
                if (sim.Buildings[c.JobId] is not { Kind: BuildingKind.Commercial or BuildingKind.Industrial })
                {
                    throw new SaveFormatException($"Citizen {c.Id} has an invalid workplace.");
                }

                workers[c.JobId] = workers.GetValueOrDefault(c.JobId) + 1;
            }

            if (c.VehicleId != 0 && sim.Traffic.Vehicles[c.VehicleId]?.CitizenId != c.Id)
            {
                throw new SaveFormatException($"Citizen {c.Id} refers to a vehicle that is not theirs.");
            }

            if (c.Age is < 0 or > 200 || c.WorkStart is < 0 or >= Simulation.TicksPerDay
                || c.ShopMinute is < -1 or >= Simulation.TicksPerDay)
            {
                throw new SaveFormatException($"Citizen {c.Id} has out-of-range values.");
            }
        }

        foreach (var b in sim.Buildings)
        {
            if (b.Residents != residents.GetValueOrDefault(b.Id) || b.Workers != workers.GetValueOrDefault(b.Id))
            {
                throw new SaveFormatException($"Building {b.Id} occupancy does not match its citizens.");
            }

            if (b.TrucksOut < 0 || b.TrucksOut > b.Spec.Vehicles)
            {
                throw new SaveFormatException($"Building {b.Id} has an invalid truck count.");
            }
        }

        foreach (var v in sim.Traffic.Vehicles)
        {
            if (v.CitizenId != 0 && sim.Citizens[v.CitizenId]?.VehicleId != v.Id)
            {
                throw new SaveFormatException($"Vehicle {v.Id} belongs to no citizen.");
            }

            if (sim.Map.Roads[v.CurrentTile] == RoadType.None || v.Progress is < 0 or > RoadSpecs.MilliTile)
            {
                throw new SaveFormatException($"Vehicle {v.Id} is off the road.");
            }
        }
    }

    // ---- helpers ----

    private static void WriteEnumBytes<T>(BinaryWriter w, T[] values) where T : struct, Enum
    {
        foreach (var v in values)
        {
            w.Write(Convert.ToByte(v));
        }
    }

    private static void WriteInts(BinaryWriter w, int[] values)
    {
        w.Write(values.Length);
        foreach (int v in values)
        {
            w.Write(v);
        }
    }

    private static void ReadInts(BinaryReader r, int[] target)
    {
        if (r.ReadInt32() != target.Length)
        {
            throw new SaveFormatException("Array length does not match the map.");
        }

        for (int i = 0; i < target.Length; i++)
        {
            target[i] = r.ReadInt32();
        }
    }

    private static void ReadExact(BinaryReader r, byte[] target)
    {
        int read = r.Read(target, 0, target.Length);
        if (read != target.Length)
        {
            throw new EndOfStreamException();
        }
    }

    private static T CheckedEnum<T>(byte value, int max) where T : struct, Enum
    {
        if (value > max)
        {
            throw new SaveFormatException($"Invalid {typeof(T).Name} value {value}.");
        }

        return (T)Enum.ToObject(typeof(T), value);
    }
}
