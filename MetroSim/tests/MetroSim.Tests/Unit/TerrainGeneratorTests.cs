using MetroSim.Core.World;

namespace MetroSim.Tests.Unit;

public sealed class TerrainGeneratorTests
{
    [Fact]
    public void Generate_SameSettings_IdenticalMaps()
    {
        var settings = new MapSettings { Width = 96, Height = 80, Seed = 1234 };
        var a = TerrainGenerator.Generate(settings);
        var b = TerrainGenerator.Generate(settings);
        Assert.Equal(a.Elevation, b.Elevation);
        Assert.Equal(a.Terrain, b.Terrain);
        Assert.Equal(a.Trees, b.Trees);
    }

    [Fact]
    public void Generate_DifferentSeeds_DifferentMaps()
    {
        var a = TerrainGenerator.Generate(new MapSettings { Seed = 1 });
        var b = TerrainGenerator.Generate(new MapSettings { Seed = 2 });
        Assert.NotEqual(a.Elevation, b.Elevation);
    }

    [Fact]
    public void Generate_RespectsConfiguredSize()
    {
        var map = TerrainGenerator.Generate(new MapSettings { Width = 64, Height = 40, Seed = 3 });
        Assert.Equal(64, map.Width);
        Assert.Equal(40, map.Height);
        Assert.Equal(64 * 40, map.Terrain.Length);
    }

    [Fact]
    public void Generate_ProducesEveryTerrainTypeAndTrees()
    {
        var map = TerrainGenerator.Generate(new MapSettings { Seed = 42 });
        foreach (var type in Enum.GetValues<TerrainType>())
        {
            Assert.Contains(type, map.Terrain);
        }

        Assert.Contains(map.Trees, t => t > 0);
    }

    [Fact]
    public void Generate_WaterCoverageRoughlyMatchesSetting()
    {
        var map = TerrainGenerator.Generate(new MapSettings { Seed = 7, WaterCoverage = 0.25, Rivers = 0 });
        double water = map.Terrain.Count(t => t == TerrainType.Water) / (double)map.TileCount;
        Assert.InRange(water, 0.22, 0.30);
    }

    [Fact]
    public void Generate_ZeroCoverage_IsAllLand()
    {
        var map = TerrainGenerator.Generate(new MapSettings { Seed = 7, WaterCoverage = 0, RockCoverage = 0, Rivers = 0, TreeCoverage = 0 });
        Assert.All(map.Terrain, t => Assert.Equal(TerrainType.Grass, t));
        Assert.All(map.Trees, t => Assert.Equal(0, t));
    }

    [Fact]
    public void Generate_TreesOnlyOnGrass()
    {
        var map = TerrainGenerator.Generate(new MapSettings { Seed = 11 });
        for (int i = 0; i < map.TileCount; i++)
        {
            if (map.Trees[i] > 0)
            {
                Assert.Equal(TerrainType.Grass, map.Terrain[i]);
            }
        }
    }

    [Theory]
    [InlineData(16, 64)]
    [InlineData(64, 1024)]
    public void Generate_RejectsSizesOutOfRange(int width, int height)
    {
        Assert.Throws<ArgumentException>(() => TerrainGenerator.Generate(new MapSettings { Width = width, Height = height }));
    }

    [Fact]
    public void Generate_RejectsInvalidCoverage()
    {
        Assert.Throws<ArgumentException>(() => TerrainGenerator.Generate(new MapSettings { WaterCoverage = 0.9 }));
    }
}
