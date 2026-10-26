using System.Diagnostics;
using MetroSim.Core.Buildings;
using MetroSim.Core.Citizens;
using MetroSim.Core.Economy;
using MetroSim.Core.Infrastructure;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.Traffic;
using MetroSim.Core.World;

namespace MetroSim.Core.Engine;

/// <summary>
/// The whole city and the tick loop. Single-threaded and deterministic: the same seed and the same
/// command log always produce the same state. Not thread-safe; see <see cref="SimulationRunner"/>.
/// </summary>
public sealed class Simulation : ITripListener
{
    public const int TicksPerHour = 60;
    public const int TicksPerDay = 24 * TicksPerHour;
    public const int DaysPerYear = 12;
    public const int UtilityInterval = 10;

    internal Simulation(MapSettings settings, CityMap map, RngSet rng)
    {
        Settings = settings;
        Map = map;
        Rng = rng;
        Roads = new RoadGraph(map);
        Search = new RoadSearch(map);
        Pathfinder = new Pathfinder(map);
        Traffic = new TrafficSystem(map, Roads, Pathfinder);
        Index = new BuildingIndex(this);
        CitizenSystem = new CitizenSystem(this);
        Growth = new GrowthSystem(this);
        Utilities = new UtilitySystem(this);
        Services = new ServiceSystem(this);
        Land = new LandSystem(this);
        EconomySystem = new EconomySystem(this);
        Commands = new CommandProcessor(this);
    }

    public MapSettings Settings { get; }

    public CityMap Map { get; }

    public RoadGraph Roads { get; }

    public Pathfinder Pathfinder { get; }

    public TrafficSystem Traffic { get; }

    public EntityStore<Building> Buildings { get; } = new();

    public EntityStore<Citizen> Citizens { get; } = new();

    public Budget Budget { get; } = new();

    public ZoneDemand Demand { get; } = new();

    public CityStats Stats { get; } = new();

    public StatsHistory History { get; } = new();

    public EventLog Events { get; } = new();

    public List<LoggedCommand> CommandLog { get; } = [];

    public PerformanceCounters Performance { get; } = new();

    /// <summary>Completed ticks (minutes) since the city was founded.</summary>
    public long Tick { get; internal set; }

    /// <summary>0-based day in progress.</summary>
    public int Day => (int)(Tick / TicksPerDay);

    public int MinuteOfDay => (int)(Tick % TicksPerDay);

    /// <summary>
    /// Bumped whenever a building is added, removed, completed, abandoned or changes road access. Not
    /// saved: caches keyed on it are rebuilt from current state, which keeps them a pure function of it.
    /// </summary>
    internal int BuildingsVersion { get; private set; }

    internal void TouchBuildings() => BuildingsVersion++;

    /// <summary>Elevation below which tiles are water (wind and display use it).</summary>
    public int WaterLevel { get; internal set; }

    internal RngSet Rng { get; }

    internal RoadSearch Search { get; }

    internal BuildingIndex Index { get; }

    internal CitizenSystem CitizenSystem { get; }

    internal GrowthSystem Growth { get; }

    internal UtilitySystem Utilities { get; }

    internal ServiceSystem Services { get; }

    internal LandSystem Land { get; }

    internal EconomySystem EconomySystem { get; }

    internal CommandProcessor Commands { get; }

    public static Simulation Create(MapSettings settings)
    {
        var map = TerrainGenerator.Generate(settings);
        var sim = new Simulation(settings, map, RngSet.FromSeed(settings.Seed));
        sim.WaterLevel = ComputeWaterLevel(map);
        sim.Land.Recompute();
        sim.Budget.Today.Day = 0;
        return sim;
    }

    /// <summary>Validates and applies a command now (between ticks), and logs it on success.</summary>
    public CommandResult Execute(GameCommand command)
    {
        var result = Commands.Apply(command, dryRun: false);
        if (result.Success)
        {
            CommandLog.Add(new LoggedCommand(Tick, command));
        }

        return result;
    }

    /// <summary>Cost and validity of a command without applying it (tool previews).</summary>
    public CommandResult Estimate(GameCommand command) => Commands.Apply(command, dryRun: true);

    public void Step()
    {
        long started = Stopwatch.GetTimestamp();
        long tick = Tick + 1;
        int minute = (int)(tick % TicksPerDay);

        CitizenSystem.UpdateTick(tick, minute);
        Traffic.Update(tick, this);
        Services.UpdateFires(tick);
        if (tick % UtilityInterval == 0)
        {
            Utilities.Recompute();
        }

        if (minute % TicksPerHour == 0)
        {
            Hourly(tick);
        }

        if (minute == 0)
        {
            Daily(tick);
        }

        Tick = tick;
        Performance.Record(Stopwatch.GetTimestamp() - started);
    }

    public void Run(int ticks)
    {
        for (int i = 0; i < ticks; i++)
        {
            Step();
        }
    }

    public void RunDays(int days) => Run(days * TicksPerDay);

    public void AddEvent(EventSeverity severity, string message, int tile = -1) =>
        Events.Add(new CityEvent(Tick, severity, message, tile));

    /// <summary>
    /// Service coverage bits per road tile from the last hourly pass (1 = fire, 2 = health, 4 = garbage).
    /// Empty until the first hour after a load; per-building flags (<c>CoveredBy*</c>) are always current.
    /// </summary>
    public ReadOnlySpan<byte> ServiceCoverage => Services.TileCoverage;

    /// <summary>Power a plant produces right now (wind output depends on elevation).</summary>
    public int PowerOutputOf(Building building) => Utilities.PowerOutputOf(building);

    /// <summary>Road tile a footprint would use for access, or -1 (for tool previews).</summary>
    public int FindAccess(int x, int y, int size) => GrowthSystem.FindAccess(Map, x, y, size);

    /// <summary>Whole-state fingerprint (SHA-256 over every saved chunk).</summary>
    public string ComputeStateHash() => Serialization.SimulationSerializer.ComputeHash(this);

    private void Hourly(long tick)
    {
        Traffic.RollHour();
        Growth.AdvanceConstruction();
        Services.RecomputeCoverage();
        Land.Recompute();
        Services.IgniteFires();
        StatsCalculator.Recompute(this);
        var (r, c, i) = EconomyModel.ComputeDemand(new EconomyModel.DemandInputs(
            Stats.Population, Stats.WorkingAge, Stats.Employed, Stats.ResidentialCapacity,
            Stats.CommercialJobs, Stats.IndustrialJobs, Stats.AverageSatisfaction,
            Budget.ResidentialTax, Budget.CommercialTax, Budget.IndustrialTax));
        Demand.Residential = r;
        Demand.Commercial = c;
        Demand.Industrial = i;
        Growth.SpawnBuildings();
        CitizenSystem.MatchJobs();
        CitizenSystem.MigrateIn(Demand.Residential);
        StatsCalculator.Recompute(this);
        History.Add(new HourSample(tick, Stats.Population, Budget.Money, Traffic.Vehicles.Count,
            Traffic.Metrics.TravelTimeIndex, Traffic.Metrics.CarTripsLastHour, Stats.Employed, Stats.Jobs,
            Stats.AverageSatisfaction));
    }

    private void Daily(long tick)
    {
        int endedDay = (int)(tick / TicksPerDay) - 1;
        Services.CollectGarbage();
        EconomySystem.SettleDay(endedDay);
        CitizenSystem.Daily(endedDay + 1);
        Growth.DailyConditions();
        StatsCalculator.Recompute(this);
        StatsCalculator.RaiseDailyWarnings(this);
    }

    internal static int ComputeWaterLevel(CityMap map)
    {
        int level = 0;
        for (int i = 0; i < map.TileCount; i++)
        {
            if (map.Terrain[i] == TerrainType.Water)
            {
                level = Math.Max(level, map.Elevation[i] + 1);
            }
        }

        return level;
    }

    void ITripListener.OnArrived(Vehicle vehicle, long tick)
    {
        if (vehicle.Kind == VehicleKind.FireTruck)
        {
            Services.OnTruckArrived(vehicle, tick);
        }
        else
        {
            CitizenSystem.OnArrived(vehicle, tick);
        }
    }

    void ITripListener.OnAborted(Vehicle vehicle, long tick)
    {
        if (vehicle.Kind == VehicleKind.FireTruck)
        {
            Services.OnTruckAborted(vehicle);
        }
        else
        {
            CitizenSystem.OnAborted(vehicle);
        }
    }

    int ITripListener.ResolveDestination(Vehicle vehicle) => Buildings[vehicle.TargetBuildingId]?.AccessTile ?? -1;

    internal void NotifyRoadsChanged() => Traffic.OnRoadsChanged(Tick, this);
}

/// <summary>Independent random streams so a change in one system does not reshuffle the others.</summary>
internal sealed class RngSet
{
    public RngSet(Pcg32 growth, Pcg32 citizens, Pcg32 events)
    {
        Growth = growth;
        Citizens = citizens;
        Events = events;
    }

    public Pcg32 Growth { get; }

    public Pcg32 Citizens { get; }

    public Pcg32 Events { get; }

    public static RngSet FromSeed(ulong seed) =>
        new(new Pcg32(seed, 101), new Pcg32(seed, 202), new Pcg32(seed, 303));
}
