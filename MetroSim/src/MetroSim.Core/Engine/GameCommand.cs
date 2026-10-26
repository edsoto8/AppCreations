using MetroSim.Core.Buildings;
using MetroSim.Core.World;

namespace MetroSim.Core.Engine;

/// <summary>
/// A player action. Commands are applied between ticks by <see cref="Simulation.Execute"/> and logged
/// so that replaying the log from the seed rebuilds the same city.
/// </summary>
public abstract record GameCommand;

/// <summary>Road along an L-shaped path: horizontally from (X0,Y0) to X1, then vertically to Y1.</summary>
public sealed record BuildRoadCommand(int X0, int Y0, int X1, int Y1, RoadType Type) : GameCommand;

public sealed record BuildPowerLineCommand(int X0, int Y0, int X1, int Y1) : GameCommand;

/// <summary>Removes roads, power lines and buildings in a rectangle (zoning stays).</summary>
public sealed record BulldozeCommand(int X0, int Y0, int X1, int Y1) : GameCommand;

/// <summary>Paints a zone over a rectangle; <see cref="ZoneType.None"/> dezones (and demolishes zoned buildings).</summary>
public sealed record ZoneCommand(int X0, int Y0, int X1, int Y1, ZoneType Zone) : GameCommand;

/// <summary>Places a service building with its top-left tile at (X, Y).</summary>
public sealed record PlaceBuildingCommand(BuildingKind Kind, int X, int Y) : GameCommand;

public sealed record SetTaxCommand(ZoneType Zone, int Percent) : GameCommand;

public sealed record CommandResult(bool Success, string Message, long Cost, int TilesAffected)
{
    public static CommandResult Fail(string message) => new(false, message, 0, 0);
}

public readonly record struct LoggedCommand(long Tick, GameCommand Command);

public static class CommandPaths
{
    /// <summary>Tiles of the L-shaped path used by road and power line tools, without duplicates.</summary>
    public static List<(int X, int Y)> LPath(int x0, int y0, int x1, int y1)
    {
        var tiles = new List<(int, int)>();
        int step = x1 >= x0 ? 1 : -1;
        for (int x = x0; x != x1 + step; x += step)
        {
            tiles.Add((x, y0));
        }

        step = y1 >= y0 ? 1 : -1;
        for (int y = y0 + step; y != y1 + step && y0 != y1; y += step)
        {
            tiles.Add((x1, y));
        }

        return tiles;
    }

    public static (int MinX, int MinY, int MaxX, int MaxY) Rect(int x0, int y0, int x1, int y1) =>
        (Math.Min(x0, x1), Math.Min(y0, y1), Math.Max(x0, x1), Math.Max(y0, y1));
}
