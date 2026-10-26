namespace MetroSim.Core.Mathematics;

/// <summary>
/// PCG32 (XSH-RR) pseudo-random generator. Small, fast and fully deterministic across platforms and
/// .NET versions (unlike <see cref="Random"/>), and its whole state is two integers that can be saved.
/// </summary>
public sealed class Pcg32
{
    private const ulong Multiplier = 6364136223846793005UL;

    public Pcg32(ulong seed, ulong stream)
    {
        Increment = (stream << 1) | 1UL;
        State = 0;
        NextUInt();
        State = unchecked(State + seed);
        NextUInt();
    }

    private Pcg32(ulong state, ulong increment, bool _)
    {
        State = state;
        Increment = increment;
    }

    public ulong State { get; private set; }

    public ulong Increment { get; }

    public static Pcg32 FromState(ulong state, ulong increment) => new(state, increment, true);

    public uint NextUInt()
    {
        ulong old = State;
        State = unchecked(old * Multiplier + Increment);
        uint xorShifted = (uint)(((old >> 18) ^ old) >> 27);
        int rotation = (int)(old >> 59);
        return (xorShifted >> rotation) | (xorShifted << (-rotation & 31));
    }

    /// <summary>Unbiased integer in [0, bound).</summary>
    public int Next(int bound)
    {
        if (bound <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(bound), bound, "Bound must be positive.");
        }

        uint b = (uint)bound;
        uint threshold = unchecked(0u - b) % b;
        while (true)
        {
            uint r = NextUInt();
            if (r >= threshold)
            {
                return (int)(r % b);
            }
        }
    }

    /// <summary>Unbiased integer in [min, maxExclusive).</summary>
    public int Next(int min, int maxExclusive) => min + Next(maxExclusive - min);

    /// <summary>True with probability numerator/denominator.</summary>
    public bool Chance(int numerator, int denominator) => numerator > 0 && Next(denominator) < numerator;

    /// <summary>Double in [0, 1). Only used for terrain generation inputs.</summary>
    public double NextDouble() => NextUInt() * (1.0 / 4294967296.0);
}
