using MetroSim.Core.Mathematics;

namespace MetroSim.Core.World;

/// <summary>
/// Procedural terrain: fractal-noise elevation, percentile water and rock levels, carved rivers,
/// beaches and moisture-driven trees. Fully reproducible from <see cref="MapSettings"/>.
/// </summary>
public static class TerrainGenerator
{
    public static CityMap Generate(MapSettings settings)
    {
        settings.Validate();
        var map = new CityMap(settings.Width, settings.Height);
        int w = settings.Width;
        int h = settings.Height;
        int n = w * h;

        var heightNoise = new PerlinNoise(settings.Seed);
        var moistureNoise = new PerlinNoise(settings.Seed ^ 0xA5A5_5A5A_1234_8765UL);
        var offsetRng = new Pcg32(settings.Seed, 11);
        double ox = offsetRng.Next(10_000);
        double oy = offsetRng.Next(10_000);
        double scale = settings.FeatureScale;

        var raw = new double[n];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                double e = heightNoise.Fractal((x + ox) / scale, (y + oy) / scale, 5);
                // Ridge term sharpens mountains without transcendental functions.
                double ridge = 1 - Math.Abs(heightNoise.Sample((x + oy) / (scale * 0.5), (y + ox) / (scale * 0.5)));
                raw[y * w + x] = e * 0.8 + ridge * ridge * 0.2;
            }
        }

        Normalize(raw);
        for (int i = 0; i < n; i++)
        {
            map.Elevation[i] = (byte)Math.Clamp((int)(raw[i] * 255.0), 0, 255);
        }

        byte waterLevel = Percentile(map.Elevation, settings.WaterCoverage);
        byte rockLevel = Percentile(map.Elevation, 1.0 - settings.RockCoverage);
        for (int i = 0; i < n; i++)
        {
            byte e = map.Elevation[i];
            map.Terrain[i] = settings.WaterCoverage > 0 && e < waterLevel ? TerrainType.Water
                : settings.RockCoverage > 0 && e >= rockLevel ? TerrainType.Rock
                : TerrainType.Grass;
        }

        var riverRng = new Pcg32(settings.Seed, 23);
        for (int r = 0; r < settings.Rivers; r++)
        {
            CarveRiver(map, riverRng, waterLevel);
        }

        AddBeaches(map);
        PlaceTrees(map, moistureNoise, settings, ox, oy);
        map.TouchTerrain();
        return map;
    }

    private static void Normalize(double[] values)
    {
        double min = double.MaxValue;
        double max = double.MinValue;
        foreach (double v in values)
        {
            min = Math.Min(min, v);
            max = Math.Max(max, v);
        }

        double range = max - min;
        for (int i = 0; i < values.Length; i++)
        {
            values[i] = range <= 0 ? 0.5 : (values[i] - min) / range;
        }
    }

    /// <summary>Smallest elevation such that at least <paramref name="fraction"/> of tiles lie below it.</summary>
    private static byte Percentile(byte[] elevation, double fraction)
    {
        var histogram = new int[256];
        foreach (byte e in elevation)
        {
            histogram[e]++;
        }

        long target = (long)(fraction * elevation.Length);
        long seen = 0;
        for (int level = 0; level < 256; level++)
        {
            if (seen >= target)
            {
                return (byte)level;
            }

            seen += histogram[level];
        }

        return 255;
    }

    /// <summary>
    /// Starts at a high land tile and walks downhill (steepest descent, random tie-break) to water or the
    /// map edge, turning tiles into water. Local minima become a small lake that ends the river.
    /// </summary>
    private static void CarveRiver(CityMap map, Pcg32 rng, byte waterLevel)
    {
        int w = map.Width;
        int start = -1;
        int bestElevation = -1;
        for (int attempt = 0; attempt < 64; attempt++)
        {
            int candidate = rng.Next(map.TileCount);
            if (map.Terrain[candidate] != TerrainType.Water && map.Elevation[candidate] > bestElevation)
            {
                bestElevation = map.Elevation[candidate];
                start = candidate;
            }
        }

        if (start < 0)
        {
            return;
        }

        int current = start;
        var visited = new HashSet<int>();
        for (int steps = 0; steps < map.Width + map.Height * 2; steps++)
        {
            visited.Add(current);
            map.Terrain[current] = TerrainType.Water;
            map.Elevation[current] = (byte)Math.Min((int)map.Elevation[current], waterLevel > 0 ? waterLevel - 1 : 0);

            int cx = current % w;
            int cy = current / w;
            if (cx == 0 || cy == 0 || cx == w - 1 || cy == map.Height - 1)
            {
                return;
            }

            int next = -1;
            int nextElevation = int.MaxValue;
            int firstDir = rng.Next(4);
            bool reachedWater = false;
            for (int k = 0; k < 4; k++)
            {
                int nb = map.Neighbor(current, (firstDir + k) & 3);
                if (nb < 0 || visited.Contains(nb))
                {
                    continue;
                }

                if (map.Terrain[nb] == TerrainType.Water)
                {
                    reachedWater = true;
                    break;
                }

                if (map.Elevation[nb] < nextElevation)
                {
                    nextElevation = map.Elevation[nb];
                    next = nb;
                }
            }

            if (reachedWater)
            {
                return;
            }

            if (next < 0 || nextElevation > map.Elevation[current] + 12)
            {
                MakeLake(map, current, 2, waterLevel);
                return;
            }

            current = next;
        }
    }

    private static void MakeLake(CityMap map, int center, int radius, byte waterLevel)
    {
        int cx = map.X(center);
        int cy = map.Y(center);
        for (int dy = -radius; dy <= radius; dy++)
        {
            for (int dx = -radius; dx <= radius; dx++)
            {
                int x = cx + dx;
                int y = cy + dy;
                if (map.InBounds(x, y) && dx * dx + dy * dy <= radius * radius + 1)
                {
                    int i = map.Index(x, y);
                    map.Terrain[i] = TerrainType.Water;
                    map.Elevation[i] = (byte)Math.Min((int)map.Elevation[i], waterLevel > 0 ? waterLevel - 1 : 0);
                }
            }
        }
    }

    private static void AddBeaches(CityMap map)
    {
        var beach = new List<int>();
        for (int i = 0; i < map.TileCount; i++)
        {
            if (map.Terrain[i] != TerrainType.Grass)
            {
                continue;
            }

            int waterNeighbours = 0;
            for (int d = 0; d < 4; d++)
            {
                int nb = map.Neighbor(i, d);
                if (nb >= 0 && map.Terrain[nb] == TerrainType.Water)
                {
                    waterNeighbours++;
                }
            }

            // Wide water bodies get sandy shores; narrow river banks mostly stay grass.
            if (waterNeighbours >= 2 || (waterNeighbours == 1 && map.Elevation[i] % 3 == 0))
            {
                beach.Add(i);
            }
        }

        foreach (int i in beach)
        {
            map.Terrain[i] = TerrainType.Sand;
        }
    }

    private static void PlaceTrees(CityMap map, PerlinNoise moisture, MapSettings settings, double ox, double oy)
    {
        if (settings.TreeCoverage <= 0)
        {
            return;
        }

        int n = map.TileCount;
        var values = new double[n];
        for (int i = 0; i < n; i++)
        {
            int x = i % map.Width;
            int y = i / map.Width;
            values[i] = moisture.Fractal((x + oy) / (settings.FeatureScale * 0.6), (y + ox) / (settings.FeatureScale * 0.6), 4);
        }

        Normalize(values);
        var grassValues = new List<double>();
        for (int i = 0; i < n; i++)
        {
            if (map.Terrain[i] == TerrainType.Grass)
            {
                grassValues.Add(values[i]);
            }
        }

        if (grassValues.Count == 0)
        {
            return;
        }

        grassValues.Sort();
        int cut = Math.Clamp((int)((1 - settings.TreeCoverage) * grassValues.Count), 0, grassValues.Count - 1);
        double threshold = grassValues[cut];
        for (int i = 0; i < n; i++)
        {
            if (map.Terrain[i] == TerrainType.Grass && values[i] >= threshold)
            {
                double depth = (values[i] - threshold) / Math.Max(1e-9, 1 - threshold);
                map.Trees[i] = (byte)(depth > 0.5 ? 3 : depth > 0.2 ? 2 : 1);
            }
        }
    }
}
