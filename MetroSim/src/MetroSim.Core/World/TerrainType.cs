namespace MetroSim.Core.World;

public enum TerrainType : byte
{
    Water = 0,
    Sand = 1,
    Grass = 2,
    Rock = 3,
}

public enum ZoneType : byte
{
    None = 0,
    Residential = 1,
    Commercial = 2,
    Industrial = 3,
}

public enum RoadType : byte
{
    None = 0,
    Street = 1,
    Avenue = 2,
}
