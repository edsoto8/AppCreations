using System.Diagnostics;
using Avalonia.Media;
using CommunityToolkit.Mvvm.ComponentModel;
using MetroSim.App.Controls;
using MetroSim.App.Game;
using MetroSim.App.Rendering;
using MetroSim.Core.Engine;

namespace MetroSim.App.ViewModels;

/// <summary>A dashboard made of stat lines and a chart.</summary>
public abstract partial class StatsPanelViewModel : ObservableObject
{
    [ObservableProperty]
    private IReadOnlyList<StatLine> _lines = [];

    [ObservableProperty]
    private IReadOnlyList<ChartSeries> _chart = [];

    /// <summary>Call with the state lock held: copy what the panel needs.</summary>
    public abstract void Capture(Simulation sim);

    /// <summary>UI thread, after the lock is released: update bindings.</summary>
    public abstract void Publish();

    protected static IReadOnlyList<double> Series(HourSample[] samples, Func<HourSample, double> value) =>
        samples.Select(value).ToArray();
}

/// <summary>Population, jobs, satisfaction and utilities.</summary>
public sealed class CityViewModel : StatsPanelViewModel
{
    private CityStats _stats = new();
    private (int R, int C, int I) _demand;
    private HourSample[] _history = [];
    private int _historyCount = -1;
    private long _historyTick = -1;
    private bool _historyChanged;

    public override void Capture(Simulation sim)
    {
        var s = sim.Stats;
        _stats = new CityStats
        {
            Population = s.Population, Children = s.Children, WorkingAge = s.WorkingAge, Seniors = s.Seniors,
            Employed = s.Employed, Unemployed = s.Unemployed, CommercialJobs = s.CommercialJobs, IndustrialJobs = s.IndustrialJobs,
            ResidentialBuildings = s.ResidentialBuildings, CommercialBuildings = s.CommercialBuildings,
            IndustrialBuildings = s.IndustrialBuildings, ServiceBuildings = s.ServiceBuildings,
            AbandonedBuildings = s.AbandonedBuildings, UnderConstruction = s.UnderConstruction, BurningBuildings = s.BurningBuildings,
            AverageSatisfaction = s.AverageSatisfaction, PowerProduction = s.PowerProduction, PowerDemand = s.PowerDemand,
            UnpoweredBuildings = s.UnpoweredBuildings, WaterCapacity = s.WaterCapacity, WaterDemand = s.WaterDemand,
            UnwateredBuildings = s.UnwateredBuildings, UncollectedGarbage = s.UncollectedGarbage,
            GarbageProducedPerDay = s.GarbageProducedPerDay, GarbageCapacityPerDay = s.GarbageCapacityPerDay,
            LandfillUsedPercent = s.LandfillUsedPercent, TotalBirths = s.TotalBirths, TotalDeaths = s.TotalDeaths,
            TotalMovedIn = s.TotalMovedIn, TotalMovedOut = s.TotalMovedOut, ResidentialCapacity = s.ResidentialCapacity,
        };
        _demand = (sim.Demand.Residential, sim.Demand.Commercial, sim.Demand.Industrial);
        var samples = sim.History.Samples;
        long last = samples.Count > 0 ? samples[^1].Tick : -1;
        _historyChanged = samples.Count != _historyCount || last != _historyTick;
        if (_historyChanged)
        {
            _historyCount = samples.Count;
            _historyTick = last;
            _history = samples.ToArray();
        }
    }

    public override void Publish()
    {
        var s = _stats;
        Lines =
        [
            new("Population", $"{Format.Number(s.Population)}  ({s.Children} children, {s.WorkingAge} adults, {s.Seniors} seniors)"),
            new("Housing", $"{Format.Number(s.Population)} / {Format.Number(s.ResidentialCapacity)} places"),
            new("Employed", $"{Format.Number(s.Employed)}  ({s.UnemploymentPercent}% unemployed)", s.UnemploymentPercent > 12),
            new("Jobs", $"{Format.Number(s.Jobs)}  ({Format.Number(s.CommercialJobs)} commercial, {Format.Number(s.IndustrialJobs)} industrial)"),
            new("Satisfaction", $"{s.AverageSatisfaction} / 100", s.AverageSatisfaction < 45),
            new("Demand R / C / I", $"{_demand.R} / {_demand.C} / {_demand.I}"),
            new("Buildings R / C / I", $"{s.ResidentialBuildings} / {s.CommercialBuildings} / {s.IndustrialBuildings}  (+{s.ServiceBuildings} services)"),
            new("Under construction", Format.Number(s.UnderConstruction)),
            new("Abandoned / burning", $"{s.AbandonedBuildings} / {s.BurningBuildings}", s.AbandonedBuildings > 0 || s.BurningBuildings > 0),
            new("Power", $"{Format.Number(s.PowerDemand)} / {Format.Number(s.PowerProduction)} MW  ({s.UnpoweredBuildings} unpowered)", s.UnpoweredBuildings > 0),
            new("Water", $"{Format.Number(s.WaterDemand)} / {Format.Number(s.WaterCapacity)}  ({s.UnwateredBuildings} without water)", s.UnwateredBuildings > 0),
            new("Garbage", $"{Format.Number(s.GarbageProducedPerDay)} / {Format.Number(s.GarbageCapacityPerDay)} per day, {Format.Number(s.UncollectedGarbage)} uncollected", s.UncollectedGarbage > 0),
            new("Landfill used", $"{s.LandfillUsedPercent}%", s.LandfillUsedPercent > 80),
            new("Births / deaths", $"{s.TotalBirths} / {s.TotalDeaths}"),
            new("Moved in / out", $"{s.TotalMovedIn} / {s.TotalMovedOut}"),
        ];

        if (_historyChanged)
        {
            Chart = _history.Length < 2
                ? []
                :
                [
                    new ChartSeries("Population", Color.FromRgb(0x6C, 0xB0, 0xF0), Series(_history, h => h.Population)),
                    new ChartSeries("Employed", Color.FromRgb(0x5C, 0xD6, 0x7C), Series(_history, h => h.Employed)),
                    new ChartSeries("Jobs", Color.FromRgb(0xF0, 0xB8, 0x40), Series(_history, h => h.Jobs)),
                    new ChartSeries("Satisfaction", Color.FromRgb(0xD0, 0x80, 0xF0), Series(_history, h => h.Satisfaction), SecondaryAxis: true),
                ];
        }
    }
}

/// <summary>Traffic throughput, congestion and trip statistics.</summary>
public sealed class TrafficViewModel : StatsPanelViewModel
{
    private int _vehicles;
    private int _cars;
    private int _pedestrians;
    private int _trucks;
    private int _waiting;
    private int _commute;
    private int _carTrips;
    private int _walkTrips;
    private int _tti;
    private int _tripX10;
    private long _reroutes;
    private long _completed;
    private long _aborted;
    private HourSample[] _history = [];
    private long _historyTick = -1;
    private bool _historyChanged;

    public override void Capture(Simulation sim)
    {
        _cars = _pedestrians = _trucks = _waiting = 0;
        foreach (var v in sim.Traffic.Vehicles)
        {
            switch (v.Kind)
            {
                case Core.Traffic.VehicleKind.Pedestrian: _pedestrians++; break;
                case Core.Traffic.VehicleKind.FireTruck: _trucks++; break;
                default: _cars++; break;
            }

            if (!v.InLane)
            {
                _waiting++;
            }
        }

        _vehicles = sim.Traffic.Vehicles.Count;
        var m = sim.Traffic.Metrics;
        _carTrips = m.CarTripsLastHour;
        _walkTrips = m.WalkTripsLastHour;
        _tti = m.TravelTimeIndex;
        _tripX10 = m.AverageTripMinutesX10;
        _reroutes = m.Reroutes;
        _completed = m.TripsCompleted;
        _aborted = m.TripsAborted;
        _commute = sim.Stats.AverageCommuteMinutes;
        var samples = sim.History.Samples;
        long last = samples.Count > 0 ? samples[^1].Tick : -1;
        _historyChanged = last != _historyTick;
        if (_historyChanged)
        {
            _historyTick = last;
            _history = samples.ToArray();
        }
    }

    public override void Publish()
    {
        Lines =
        [
            new("Active vehicles", $"{Format.Number(_vehicles)}  ({_cars} cars, {_pedestrians} walking, {_trucks} fire trucks)"),
            new("Waiting to enter road", Format.Number(_waiting), _waiting > 50),
            new("Car trips last hour", Format.Number(_carTrips)),
            new("Walk trips last hour", Format.Number(_walkTrips)),
            new("Travel time index", Format.Fixed(_tti / 100.0, 2) + "x free flow", _tti >= 150),
            new("Average car trip", Format.Fixed(_tripX10 / 10.0, 1) + " min"),
            new("Average commute", $"{_commute} min"),
            new("Reroutes (total)", Format.Number(_reroutes)),
            new("Trips completed / aborted", $"{Format.Number(_completed)} / {Format.Number(_aborted)}", _aborted > 0),
        ];

        if (_historyChanged)
        {
            Chart = _history.Length < 2
                ? []
                :
                [
                    new ChartSeries("Vehicles", Color.FromRgb(0x6C, 0xB0, 0xF0), Series(_history, h => h.Vehicles)),
                    new ChartSeries("Car trips/h", Color.FromRgb(0x5C, 0xD6, 0x7C), Series(_history, h => h.CarTripsLastHour)),
                    new ChartSeries("Travel time index", Color.FromRgb(0xF0, 0x6A, 0x5A), Series(_history, h => h.TravelTimeIndex / 100.0), SecondaryAxis: true),
                ];
        }
    }
}

/// <summary>Simulation and rendering performance, measured live.</summary>
public sealed class PerformanceViewModel : StatsPanelViewModel
{
    private readonly Func<RenderStats?> _renderStats;
    private readonly Queue<(double Fps, double Tps)> _samples = new();
    private double _tps;
    private double _tickAvg;
    private double _tickMax;
    private long _ticks;
    private long _searches;
    private long _nodes;
    private long _searchTicks;
    private int _buildings;
    private int _citizens;
    private int _vehicles;
    private string _map = "";

    public PerformanceViewModel(Func<RenderStats?> renderStats) => _renderStats = renderStats;

    public double TicksPerSecond => _tps;

    public override void Capture(Simulation sim)
    {
        _tickAvg = sim.Performance.AverageTickMilliseconds;
        _tickMax = sim.Performance.MaxTickMilliseconds;
        _ticks = sim.Performance.TicksExecuted;
        _searches = sim.Pathfinder.Searches;
        _nodes = sim.Pathfinder.NodesExpanded;
        _searchTicks = sim.Pathfinder.ElapsedTicks;
        _buildings = sim.Buildings.Count;
        _citizens = sim.Citizens.Count;
        _vehicles = sim.Traffic.Vehicles.Count;
        _map = $"{sim.Map.Width} x {sim.Map.Height}";
    }

    /// <summary>Set by the main view model from the runner (not simulation state).</summary>
    public void SetTicksPerSecond(double tps) => _tps = tps;

    public override void Publish()
    {
        var render = _renderStats();
        double fps = render?.FramesPerSecond ?? 0;
        var (frameAvg, frameMax) = render?.FrameMilliseconds ?? (0, 0);
        double usPerSearch = _searches == 0 ? 0 : _searchTicks * 1_000_000.0 / Stopwatch.Frequency / _searches;
        using var process = Process.GetCurrentProcess();
        Lines =
        [
            new("Simulation speed", $"{Format.Fixed(_tps, 0)} ticks/s"),
            new("Render rate", $"{Format.Fixed(fps, 1)} FPS", fps is > 0 and < 30),
            new("Map draw time", $"{Format.Fixed(frameAvg, 2)} ms avg, {Format.Fixed(frameMax, 2)} ms max"),
            new("Frame snapshot (UI)", $"{Format.Fixed(render?.SnapshotMilliseconds ?? 0, 2)} ms, {Format.Number(render?.StaleFrames ?? 0)} frames reused data (lock busy)"),
            new("Tick time", $"{Format.Fixed(_tickAvg, 3)} ms avg, {Format.Fixed(_tickMax, 2)} ms max (last 256)"),
            new("Ticks executed", Format.Number(_ticks)),
            new("Pathfinding", $"{Format.Number(_searches)} searches, {Format.Fixed(usPerSearch, 1)} µs avg, {(_searches == 0 ? 0 : _nodes / _searches)} nodes avg"),
            new("Managed memory", Format.Bytes(GC.GetTotalMemory(false))),
            new("Working set", Format.Bytes(process.WorkingSet64)),
            new("GC collections (0/1/2)", $"{GC.CollectionCount(0)} / {GC.CollectionCount(1)} / {GC.CollectionCount(2)}"),
            new("Map chunk cache", $"{render?.CachedChunks ?? 0} images, {Format.Bytes(render?.CachedBytes ?? 0)}"),
            new("Vehicles drawn", $"{render?.VisibleVehicles ?? 0} of {_vehicles}"),
            new("Entities", $"{Format.Number(_buildings)} buildings, {Format.Number(_citizens)} citizens"),
            new("Map", _map),
        ];

        _samples.Enqueue((fps, _tps));
        while (_samples.Count > 120)
        {
            _samples.Dequeue();
        }

        Chart = _samples.Count < 2
            ? []
            :
            [
                new ChartSeries("FPS", Color.FromRgb(0x5C, 0xD6, 0x7C), _samples.Select(s => s.Fps).ToArray()),
                new ChartSeries("Ticks/s", Color.FromRgb(0x6C, 0xB0, 0xF0), _samples.Select(s => s.Tps).ToArray(), SecondaryAxis: true),
            ];
    }
}
