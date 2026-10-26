namespace MetroSim.Core.Mathematics;

/// <summary>Grid directions. Index order is fixed because lanes are stored as tile*4 + direction.</summary>
public enum Direction : byte
{
    North = 0,
    East = 1,
    South = 2,
    West = 3,
}

public static class Directions
{
    public static readonly int[] Dx = [0, 1, 0, -1];
    public static readonly int[] Dy = [-1, 0, 1, 0];

    public static Direction Opposite(Direction d) => (Direction)(((int)d + 2) & 3);

    /// <summary>Direction of travel between two 4-adjacent tiles.</summary>
    public static Direction Between(int fromTile, int toTile)
    {
        int delta = toTile - fromTile;
        if (delta == 1)
        {
            return Direction.East;
        }

        if (delta == -1)
        {
            return Direction.West;
        }

        return delta > 0 ? Direction.South : Direction.North;
    }
}
