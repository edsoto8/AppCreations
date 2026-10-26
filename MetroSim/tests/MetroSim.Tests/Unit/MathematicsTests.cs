using MetroSim.Core.Mathematics;

namespace MetroSim.Tests.Unit;

public sealed class MathematicsTests
{
    [Fact]
    public void Pcg32_ReferenceSeed_MatchesPublishedSequence()
    {
        // pcg32_srandom(42, 54) from the PCG reference implementation (pcg32-demo).
        var rng = new Pcg32(42, 54);
        uint[] expected = [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e];
        foreach (uint value in expected)
        {
            Assert.Equal(value, rng.NextUInt());
        }
    }

    [Fact]
    public void Pcg32_FromState_ContinuesIdentically()
    {
        var a = new Pcg32(7, 3);
        a.NextUInt();
        var b = Pcg32.FromState(a.State, a.Increment);
        for (int i = 0; i < 100; i++)
        {
            Assert.Equal(a.NextUInt(), b.NextUInt());
        }
    }

    [Fact]
    public void Pcg32_Next_RejectsNonPositiveBound()
    {
        var rng = new Pcg32(1, 1);
        Assert.Throws<ArgumentOutOfRangeException>(() => rng.Next(0));
    }

    [Fact]
    public void Pcg32_Next_IsRoughlyUniform()
    {
        var rng = new Pcg32(123, 9);
        var counts = new int[10];
        for (int i = 0; i < 100_000; i++)
        {
            counts[rng.Next(10)]++;
        }

        foreach (int c in counts)
        {
            Assert.InRange(c, 9_500, 10_500);
        }
    }

    [Fact]
    public void Pcg32_Chance_ZeroNumeratorIsNeverTrue()
    {
        var rng = new Pcg32(5, 5);
        for (int i = 0; i < 1000; i++)
        {
            Assert.False(rng.Chance(0, 10));
        }
    }

    [Fact]
    public void PerlinNoise_SameSeed_SameValues()
    {
        var a = new PerlinNoise(99);
        var b = new PerlinNoise(99);
        for (int i = 0; i < 200; i++)
        {
            double x = i * 0.37;
            double y = i * 0.11;
            Assert.Equal(a.Fractal(x, y, 5), b.Fractal(x, y, 5));
        }
    }

    [Fact]
    public void PerlinNoise_IsZeroAtLatticePoints()
    {
        var noise = new PerlinNoise(1);
        Assert.Equal(0, noise.Sample(3, 4));
        Assert.Equal(0, noise.Sample(-2, 10));
    }

    [Fact]
    public void MinHeap_PopsByKeyThenInsertionOrder()
    {
        var heap = new MinHeap();
        heap.Push(5, 1);
        heap.Push(2, 2);
        heap.Push(5, 3);
        heap.Push(2, 4);
        heap.Push(9, 5);
        var order = new List<int>();
        while (heap.Count > 0)
        {
            order.Add(heap.Pop(out _));
        }

        Assert.Equal([2, 4, 1, 3, 5], order);
    }

    [Fact]
    public void Directions_Between_AdjacentTiles()
    {
        const int w = 10;
        Assert.Equal(Direction.East, Directions.Between(11, 12));
        Assert.Equal(Direction.West, Directions.Between(12, 11));
        Assert.Equal(Direction.South, Directions.Between(11, 11 + w));
        Assert.Equal(Direction.North, Directions.Between(11 + w, 11));
        Assert.Equal(Direction.South, Directions.Opposite(Direction.North));
    }
}
