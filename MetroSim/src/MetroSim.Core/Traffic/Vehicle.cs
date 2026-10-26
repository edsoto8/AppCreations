using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;

namespace MetroSim.Core.Traffic;

public enum VehicleKind : byte
{
    Car = 0,
    Pedestrian = 1,
    FireTruck = 2,
}

public enum TripPurpose : byte
{
    ToWork = 0,
    ToHome = 1,
    ToShop = 2,
    FireCall = 3,
    FireReturn = 4,
}

/// <summary>
/// A moving agent: a car, a pedestrian or a fire truck. It sits on <c>Path[PathIndex]</c> and moves
/// toward <c>Path[PathIndex + 1]</c>; reaching the last path tile completes the trip.
/// </summary>
public sealed class Vehicle : IEntity
{
    public int Id { get; set; }

    public VehicleKind Kind { get; set; }

    public TripPurpose Purpose { get; set; }

    /// <summary>Owning citizen, 0 for service vehicles.</summary>
    public int CitizenId { get; set; }

    public int OriginBuildingId { get; set; }

    public int TargetBuildingId { get; set; }

    public int[] Path { get; set; } = [];

    public int PathIndex { get; set; }

    /// <summary>Progress across the current tile toward the next, 0..1000 milli-tiles.</summary>
    public int Progress { get; set; }

    /// <summary>Lane (direction of travel) occupied on the current tile.</summary>
    public Direction Lane { get; set; }

    /// <summary>False while a car waits at its origin for room on the first lane.</summary>
    public bool InLane { get; set; }

    public int WaitTicks { get; set; }

    public long StartTick { get; set; }

    /// <summary>Ticks the route would take on empty roads; travel time index denominator.</summary>
    public int FreeFlowTicks { get; set; }

    public long LastRerouteTick { get; set; }

    public int Reroutes { get; set; }

    public int CurrentTile => Path[PathIndex];

    public int NextTile => PathIndex + 1 < Path.Length ? Path[PathIndex + 1] : -1;

    public bool UsesLanes => Kind != VehicleKind.Pedestrian;
}
