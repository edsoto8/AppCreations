namespace MetroSim.Core.Mathematics;

/// <summary>
/// Seeded 2D gradient (Perlin) noise. Uses only IEEE-exact arithmetic (+, -, *, floor), so results are
/// bit-identical on every platform.
/// </summary>
public sealed class PerlinNoise
{
    private static readonly (int X, int Y)[] Gradients =
    [
        (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1),
    ];

    private readonly int[] _permutation = new int[512];

    public PerlinNoise(ulong seed)
    {
        var rng = new Pcg32(seed, 0x9E3779B97F4A7C15UL);
        var p = new int[256];
        for (int i = 0; i < 256; i++)
        {
            p[i] = i;
        }

        for (int i = 255; i > 0; i--)
        {
            int j = rng.Next(i + 1);
            (p[i], p[j]) = (p[j], p[i]);
        }

        for (int i = 0; i < 512; i++)
        {
            _permutation[i] = p[i & 255];
        }
    }

    /// <summary>Noise value, roughly in [-1, 1].</summary>
    public double Sample(double x, double y)
    {
        double fx = Math.Floor(x);
        double fy = Math.Floor(y);
        int xi = (int)fx & 255;
        int yi = (int)fy & 255;
        double xf = x - fx;
        double yf = y - fy;
        double u = Fade(xf);
        double v = Fade(yf);

        double n00 = Dot(Hash(xi, yi), xf, yf);
        double n10 = Dot(Hash(xi + 1, yi), xf - 1, yf);
        double n01 = Dot(Hash(xi, yi + 1), xf, yf - 1);
        double n11 = Dot(Hash(xi + 1, yi + 1), xf - 1, yf - 1);

        double nx0 = Lerp(n00, n10, u);
        double nx1 = Lerp(n01, n11, u);
        return Lerp(nx0, nx1, v);
    }

    /// <summary>Fractal Brownian motion: <paramref name="octaves"/> layers of noise, halving amplitude.</summary>
    public double Fractal(double x, double y, int octaves)
    {
        double total = 0;
        double amplitude = 1;
        double frequency = 1;
        double max = 0;
        for (int i = 0; i < octaves; i++)
        {
            total += Sample(x * frequency, y * frequency) * amplitude;
            max += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return total / max;
    }

    private int Hash(int x, int y) => _permutation[_permutation[x & 255] + (y & 255)] & 7;

    private static double Dot(int gradient, double x, double y)
    {
        var g = Gradients[gradient];
        return g.X * x + g.Y * y;
    }

    private static double Fade(double t) => t * t * t * (t * (t * 6 - 15) + 10);

    private static double Lerp(double a, double b, double t) => a + t * (b - a);
}
