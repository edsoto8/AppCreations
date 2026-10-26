using MetroSim.Core.Buildings;
using MetroSim.Core.Engine;
using MetroSim.Core.World;

namespace MetroSim.Core.Infrastructure;

/// <summary>Hourly pollution and land value maps.</summary>
internal sealed class LandSystem
{
    private const int WaterReach = 3;
    private readonly Simulation _sim;
    private readonly int[] _accumulator;
    private readonly byte[] _waterBonus;
    private int _waterBonusVersion = -1;

    public LandSystem(Simulation sim)
    {
        _sim = sim;
        _accumulator = new int[sim.Map.TileCount];
        _waterBonus = new byte[sim.Map.TileCount];
    }

    public void Recompute()
    {
        ComputePollution();
        ComputeLandValue();
    }

    private void ComputePollution()
    {
        var map = _sim.Map;
        Array.Clear(_accumulator);
        foreach (var b in _sim.Buildings)
        {
            var spec = b.Spec;
            if (spec.PollutionStrength == 0 || !b.IsOperating)
            {
                continue;
            }

            int strength = b.Kind.IsZoned() ? spec.PollutionStrength * (2 + b.Level) / 3 : spec.PollutionStrength;
            int r = spec.PollutionRadius;
            int cx = b.X + b.Size / 2;
            int cy = b.Y + b.Size / 2;
            for (int dy = -r; dy <= r; dy++)
            {
                for (int dx = -r; dx <= r; dx++)
                {
                    int x = cx + dx;
                    int y = cy + dy;
                    if (map.InBounds(x, y))
                    {
                        int d = Math.Max(Math.Abs(dx), Math.Abs(dy));
                        _accumulator[y * map.Width + x] += strength * (r + 1 - d) / (r + 1);
                    }
                }
            }
        }

        var volume = _sim.Traffic.VolumeLastHour;
        for (int t = 0; t < map.TileCount; t++)
        {
            if (volume[t] == 0)
            {
                continue;
            }

            int p = Math.Min(40, volume[t] / 2);
            _accumulator[t] += p;
            for (int d = 0; d < 4; d++)
            {
                int nb = map.Neighbor(t, d);
                if (nb >= 0)
                {
                    _accumulator[nb] += p / 2;
                }
            }
        }

        for (int t = 0; t < map.TileCount; t++)
        {
            map.Pollution[t] = (byte)Math.Min(255, _accumulator[t]);
        }
    }

    private void ComputeLandValue()
    {
        var map = _sim.Map;
        EnsureWaterBonus();
        var coverage = _sim.Services.TileCoverage;
        int w = map.Width;
        for (int t = 0; t < map.TileCount; t++)
        {
            if (map.Terrain[t] == TerrainType.Water)
            {
                map.LandValue[t] = 0;
                continue;
            }

            int x = t % w;
            int y = t / w;
            int trees = 0;
            byte mask = 0;
            for (int dy = -2; dy <= 2; dy++)
            {
                for (int dx = -2; dx <= 2; dx++)
                {
                    int nx = x + dx;
                    int ny = y + dy;
                    if (!map.InBounds(nx, ny))
                    {
                        continue;
                    }

                    int nb = ny * w + nx;
                    trees += map.Trees[nb];
                    mask |= coverage[nb];
                }
            }

            int value = 60 + _waterBonus[t] + Math.Min(15, trees / 2)
                + ((mask & ServiceSystem.FireBit) != 0 ? 8 : 0)
                + ((mask & ServiceSystem.HealthBit) != 0 ? 12 : 0)
                - map.Pollution[t] / 3;
            map.LandValue[t] = (byte)Math.Clamp(value, 0, 255);
        }
    }

    /// <summary>Static bonus for tiles near water; depends on terrain only.</summary>
    private void EnsureWaterBonus()
    {
        var map = _sim.Map;
        if (_waterBonusVersion == map.TerrainVersion)
        {
            return;
        }

        _waterBonusVersion = map.TerrainVersion;
        int w = map.Width;
        for (int t = 0; t < map.TileCount; t++)
        {
            int best = WaterReach + 1;
            int x = t % w;
            int y = t / w;
            for (int dy = -WaterReach; dy <= WaterReach; dy++)
            {
                for (int dx = -WaterReach; dx <= WaterReach; dx++)
                {
                    int nx = x + dx;
                    int ny = y + dy;
                    if (map.InBounds(nx, ny) && map.Terrain[ny * w + nx] == TerrainType.Water)
                    {
                        best = Math.Min(best, Math.Max(Math.Abs(dx), Math.Abs(dy)));
                    }
                }
            }

            _waterBonus[t] = (byte)(best > WaterReach ? 0 : (WaterReach + 1 - best) * 10);
        }
    }
}
