using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.Roads;
using MetroSim.Core.World;

namespace MetroSim.Core.Traffic;

/// <summary>Callbacks from traffic into the systems that own trips.</summary>
public interface ITripListener
{
    void OnArrived(Vehicle vehicle, long tick);

    void OnAborted(Vehicle vehicle, long tick);

    /// <summary>Current access road tile of the trip's destination, or -1 if it no longer exists.</summary>
    int ResolveDestination(Vehicle vehicle);
}

/// <summary>
/// Moves vehicles over directional lanes with finite capacity. Congestion, queues and spill-back emerge
/// from lane capacity, occupancy-dependent speed and per-tick intersection admission.
/// </summary>
public sealed class TrafficSystem : IRoadCostModel
{
    public const int PedestrianSpeed = 250;
    public const int IntersectionDelay = 250;
    public const int FullLanePenalty = 2_000;

    private readonly CityMap _map;
    private readonly RoadGraph _graph;
    private readonly int[] _occupancy;
    private readonly int[] _entryStamp;
    private readonly int[] _entryCount;
    private readonly List<int> _removeScratch = [];
    private int _currentStamp = -1;

    public TrafficSystem(CityMap map, RoadGraph graph, Pathfinder pathfinder)
    {
        _map = map;
        _graph = graph;
        Pathfinder = pathfinder;
        _occupancy = new int[map.TileCount * 4];
        _entryStamp = new int[map.TileCount];
        _entryCount = new int[map.TileCount];
        VolumeThisHour = new int[map.TileCount];
        VolumeLastHour = new int[map.TileCount];
    }

    public Pathfinder Pathfinder { get; }

    public EntityStore<Vehicle> Vehicles { get; } = new();

    /// <summary>Lane-using vehicles that entered each tile this hour.</summary>
    public int[] VolumeThisHour { get; }

    /// <summary>Volumes of the last completed hour (traffic overlay, traffic pollution).</summary>
    public int[] VolumeLastHour { get; }

    public int RerouteAfterTicks { get; set; } = 8;

    public int RerouteCooldownTicks { get; set; } = 30;

    public int RerouteBudgetPerTick { get; set; } = 64;

    /// <summary>Trips this short (in road tiles) are walked.</summary>
    public int WalkMaxTiles { get; set; } = 6;

    public TrafficMetrics Metrics { get; } = new();

    public int MinimumEntryCost => _graph.AvenueTiles > 0
        ? 1_000_000 / RoadSpecs.FreeFlowSpeed(RoadType.Avenue)
        : 1_000_000 / RoadSpecs.FreeFlowSpeed(RoadType.Street);

    public int LaneOccupancy(int tile, Direction lane) => _occupancy[tile * 4 + (int)lane];

    /// <summary>Highest lane load on a tile as a percentage of lane capacity (traffic overlay).</summary>
    public int LaneLoadPercent(int tile)
    {
        var road = _map.Roads[tile];
        if (road == RoadType.None)
        {
            return 0;
        }

        int max = 0;
        for (int d = 0; d < 4; d++)
        {
            max = Math.Max(max, _occupancy[tile * 4 + d]);
        }

        return max * 100 / RoadSpecs.LaneCapacity(road);
    }

    public int EntryCost(int tile, Direction travel)
    {
        var road = _map.Roads[tile];
        int capacity = RoadSpecs.LaneCapacity(road);
        int occupancy = _occupancy[tile * 4 + (int)travel];
        int cost = 1_000_000 / CongestedSpeed(road, occupancy + 1);
        if (occupancy >= capacity)
        {
            cost += FullLanePenalty;
        }

        if (_graph.IsIntersection(tile))
        {
            cost += IntersectionDelay;
        }

        return cost;
    }

    /// <summary>
    /// Starts a trip between two road tiles. Returns the vehicle id, 0 when no route exists, or -1 when
    /// origin and destination share an access tile (the trip completes instantly).
    /// </summary>
    public int Dispatch(VehicleKind kind, TripPurpose purpose, int citizenId, int originBuildingId,
        int targetBuildingId, int fromTile, int toTile, long tick)
    {
        if (fromTile < 0 || toTile < 0 || !_graph.Connected(fromTile, toTile))
        {
            return 0;
        }

        if (fromTile == toTile)
        {
            return -1;
        }

        var path = Pathfinder.FindPath(fromTile, toTile, this, out _);
        if (path is null)
        {
            return 0;
        }

        if (kind == VehicleKind.Car && path.Length - 1 <= WalkMaxTiles)
        {
            kind = VehicleKind.Pedestrian;
        }

        var vehicle = new Vehicle
        {
            Kind = kind,
            Purpose = purpose,
            CitizenId = citizenId,
            OriginBuildingId = originBuildingId,
            TargetBuildingId = targetBuildingId,
            Path = path,
            Lane = Directions.Between(path[0], path[1]),
            StartTick = tick,
            FreeFlowTicks = FreeFlowTicks(path, kind),
            LastRerouteTick = tick,
            InLane = kind == VehicleKind.Pedestrian,
        };
        Vehicles.Add(vehicle);
        TryEnterFirstLane(vehicle);
        Metrics.TripsStarted++;
        return vehicle.Id;
    }

    /// <summary>Advances every vehicle by one tick, in id order.</summary>
    public void Update(long tick, ITripListener listener)
    {
        _currentStamp = (int)(tick & 0x7FFF_FFFF);
        int rerouteBudget = RerouteBudgetPerTick;
        for (int id = 1; id < Vehicles.HighWater; id++)
        {
            var v = Vehicles[id];
            if (v is null)
            {
                continue;
            }

            if (v.Kind == VehicleKind.Pedestrian)
            {
                MovePedestrian(v, tick, listener);
                continue;
            }

            if (!v.InLane && !TryEnterFirstLane(v))
            {
                v.WaitTicks++;
                continue;
            }

            MoveVehicle(v, tick, listener);
            if (Vehicles[id] is { } still && still.WaitTicks >= RerouteAfterTicks
                && tick - still.LastRerouteTick >= RerouteCooldownTicks && rerouteBudget > 0)
            {
                rerouteBudget--;
                if (!Reroute(still, tick, listener))
                {
                    still.LastRerouteTick = tick;
                }
            }
        }
    }

    /// <summary>Aborts trips of vehicles standing on tiles that are no longer road.</summary>
    public void OnRoadsChanged(long tick, ITripListener listener)
    {
        _removeScratch.Clear();
        foreach (var v in Vehicles)
        {
            if (_map.Roads[v.CurrentTile] == RoadType.None)
            {
                _removeScratch.Add(v.Id);
            }
        }

        foreach (int id in _removeScratch)
        {
            var v = Vehicles[id]!;
            Remove(v);
            Metrics.TripsAborted++;
            listener.OnAborted(v, tick);
        }
    }

    /// <summary>Removes a vehicle and frees its lane slot without notifying anyone.</summary>
    public void Remove(Vehicle v)
    {
        if (v.UsesLanes && v.InLane)
        {
            _occupancy[v.CurrentTile * 4 + (int)v.Lane]--;
        }

        Vehicles.Remove(v.Id);
    }

    public void RollHour()
    {
        Array.Copy(VolumeThisHour, VolumeLastHour, VolumeThisHour.Length);
        Array.Clear(VolumeThisHour);
        Metrics.RollHour();
    }

    /// <summary>Rebuilds lane occupancy from vehicle positions (after loading a save).</summary>
    public void RebuildOccupancy()
    {
        Array.Clear(_occupancy);
        foreach (var v in Vehicles)
        {
            if (v.UsesLanes && v.InLane)
            {
                _occupancy[v.CurrentTile * 4 + (int)v.Lane]++;
            }
        }
    }

    private bool TryEnterFirstLane(Vehicle v)
    {
        if (v.InLane)
        {
            return true;
        }

        int slot = v.CurrentTile * 4 + (int)v.Lane;
        if (_occupancy[slot] >= Capacity(v.CurrentTile, v))
        {
            return false;
        }

        _occupancy[slot]++;
        v.InLane = true;
        return true;
    }

    private void MovePedestrian(Vehicle v, long tick, ITripListener listener)
    {
        v.Progress += PedestrianSpeed;
        while (v.Progress >= RoadSpecs.MilliTile)
        {
            int next = v.NextTile;
            if (_map.Roads[next] == RoadType.None)
            {
                if (!Reroute(v, tick, listener))
                {
                    Abort(v, tick, listener);
                }

                return;
            }

            v.Progress -= RoadSpecs.MilliTile;
            v.PathIndex++;
            if (v.PathIndex == v.Path.Length - 1)
            {
                Arrive(v, tick, listener);
                return;
            }

            v.Lane = Directions.Between(v.CurrentTile, v.NextTile);
        }
    }

    private void MoveVehicle(Vehicle v, long tick, ITripListener listener)
    {
        int current = v.CurrentTile;
        var road = _map.Roads[current];
        int speed = CongestedSpeed(road, _occupancy[current * 4 + (int)v.Lane]);
        if (v.Kind == VehicleKind.FireTruck)
        {
            speed = speed * 3 / 2;
        }

        v.Progress += speed;
        while (v.Progress >= RoadSpecs.MilliTile)
        {
            int nextIndex = v.PathIndex + 1;
            int next = v.Path[nextIndex];
            if (_map.Roads[next] == RoadType.None)
            {
                if (!Reroute(v, tick, listener))
                {
                    Abort(v, tick, listener);
                }

                return;
            }

            if (nextIndex == v.Path.Length - 1)
            {
                Arrive(v, tick, listener);
                return;
            }

            var nextLane = Directions.Between(next, v.Path[nextIndex + 1]);
            if (!CanEnter(next, nextLane, v))
            {
                v.Progress = RoadSpecs.MilliTile;
                v.WaitTicks++;
                return;
            }

            _occupancy[v.CurrentTile * 4 + (int)v.Lane]--;
            _occupancy[next * 4 + (int)nextLane]++;
            if (_graph.IsIntersection(next))
            {
                ConsumeEntry(next);
            }

            VolumeThisHour[next]++;
            v.PathIndex = nextIndex;
            v.Lane = nextLane;
            v.Progress -= RoadSpecs.MilliTile;
            v.WaitTicks = 0;
        }
    }

    private bool CanEnter(int tile, Direction lane, Vehicle v)
    {
        if (_occupancy[tile * 4 + (int)lane] >= Capacity(tile, v))
        {
            return false;
        }

        if (v.Kind == VehicleKind.FireTruck || !_graph.IsIntersection(tile))
        {
            return true;
        }

        int used = _entryStamp[tile] == _currentStamp ? _entryCount[tile] : 0;
        return used < RoadSpecs.IntersectionThroughput(_map.Roads[tile]);
    }

    private void ConsumeEntry(int tile)
    {
        if (_entryStamp[tile] != _currentStamp)
        {
            _entryStamp[tile] = _currentStamp;
            _entryCount[tile] = 0;
        }

        _entryCount[tile]++;
    }

    private int Capacity(int tile, Vehicle v)
    {
        int capacity = RoadSpecs.LaneCapacity(_map.Roads[tile]);
        return v.Kind == VehicleKind.FireTruck ? capacity + 1 : capacity;
    }

    /// <summary>Re-plans from the current tile using live congestion. False when no route exists.</summary>
    private bool Reroute(Vehicle v, long tick, ITripListener listener)
    {
        int destination = listener.ResolveDestination(v);
        int current = v.CurrentTile;
        if (destination < 0)
        {
            return false;
        }

        var path = Pathfinder.FindPath(current, destination, this, out _);
        if (path is null)
        {
            return false;
        }

        v.LastRerouteTick = tick;
        v.Reroutes++;
        Metrics.Reroutes++;
        if (path.Length == 1)
        {
            v.Path = path;
            v.PathIndex = 0;
            Arrive(v, tick, listener);
            return true;
        }

        var lane = Directions.Between(path[0], path[1]);
        if (v.UsesLanes && v.InLane && lane != v.Lane)
        {
            _occupancy[current * 4 + (int)v.Lane]--;
            _occupancy[current * 4 + (int)lane]++;
        }

        v.Path = path;
        v.PathIndex = 0;
        v.Lane = lane;
        v.WaitTicks = 0;
        return true;
    }

    private void Arrive(Vehicle v, long tick, ITripListener listener)
    {
        Remove(v);
        int ticks = (int)(tick - v.StartTick);
        Metrics.RecordArrival(v, ticks);
        listener.OnArrived(v, tick);
    }

    private void Abort(Vehicle v, long tick, ITripListener listener)
    {
        Remove(v);
        Metrics.TripsAborted++;
        listener.OnAborted(v, tick);
    }

    private static int CongestedSpeed(RoadType road, int occupancy)
    {
        int free = RoadSpecs.FreeFlowSpeed(road);
        int capacity = RoadSpecs.LaneCapacity(road);
        int others = Math.Max(0, occupancy - 1);
        int speed = free - free * 65 * others / (100 * capacity);
        return Math.Max(free * 35 / 100, speed);
    }

    private int FreeFlowTicks(int[] path, VehicleKind kind)
    {
        if (kind == VehicleKind.Pedestrian)
        {
            return (path.Length - 1) * RoadSpecs.MilliTile / PedestrianSpeed;
        }

        long milli = 0;
        for (int i = 0; i < path.Length - 1; i++)
        {
            milli += 1_000_000 / RoadSpecs.FreeFlowSpeed(_map.Roads[path[i]]);
        }

        return (int)(milli / 1000);
    }
}
