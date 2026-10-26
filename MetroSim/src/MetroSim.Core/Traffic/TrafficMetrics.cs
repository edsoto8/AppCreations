namespace MetroSim.Core.Traffic;

/// <summary>Network throughput and travel time. All fields are saved with the game.</summary>
public sealed class TrafficMetrics
{
    public long TripsStarted { get; set; }

    public long TripsCompleted { get; set; }

    public long TripsAborted { get; set; }

    public long Reroutes { get; set; }

    public int CarTripsThisHour { get; set; }

    public long CarTripTicksThisHour { get; set; }

    public long CarFreeFlowTicksThisHour { get; set; }

    public int WalkTripsThisHour { get; set; }

    /// <summary>Car trips completed in the last full hour (network throughput).</summary>
    public int CarTripsLastHour { get; set; }

    public int WalkTripsLastHour { get; set; }

    /// <summary>Mean car trip minutes over the last hour, x10.</summary>
    public int AverageTripMinutesX10 { get; set; }

    /// <summary>Actual over free-flow travel time for the last hour, x100 (100 = no congestion).</summary>
    public int TravelTimeIndex { get; set; } = 100;

    internal void RecordArrival(Vehicle v, int ticks)
    {
        TripsCompleted++;
        if (v.Kind == VehicleKind.Pedestrian)
        {
            WalkTripsThisHour++;
            return;
        }

        if (v.Kind == VehicleKind.Car)
        {
            CarTripsThisHour++;
            CarTripTicksThisHour += ticks;
            CarFreeFlowTicksThisHour += Math.Max(1, v.FreeFlowTicks);
        }
    }

    internal void RollHour()
    {
        CarTripsLastHour = CarTripsThisHour;
        WalkTripsLastHour = WalkTripsThisHour;
        if (CarTripsThisHour > 0)
        {
            AverageTripMinutesX10 = (int)(CarTripTicksThisHour * 10 / CarTripsThisHour);
            TravelTimeIndex = (int)Math.Max(100, CarTripTicksThisHour * 100 / Math.Max(1, CarFreeFlowTicksThisHour));
        }

        CarTripsThisHour = 0;
        WalkTripsThisHour = 0;
        CarTripTicksThisHour = 0;
        CarFreeFlowTicksThisHour = 0;
    }
}
