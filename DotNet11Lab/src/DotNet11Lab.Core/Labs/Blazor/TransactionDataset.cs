using System.Text.Json.Serialization;

namespace DotNet11Lab.Core.Labs.Blazor;

[JsonConverter(typeof(JsonStringEnumConverter<TransactionStatus>))]
public enum TransactionStatus { Settled, Pending, Refunded, Disputed }

/// <summary>One card transaction. <see cref="Note"/> is present on some rows, which makes their height vary.</summary>
public sealed record Transaction(
    int Id,
    DateOnly Date,
    string Merchant,
    string Category,
    string Country,
    decimal Amount,
    TransactionStatus Status,
    string Reference,
    string? Note);

/// <summary>
/// A deterministic synthetic ledger. The same count always produces the same rows (a SplitMix64 generator, not
/// System.Random, so the data does not change between runtime versions), which keeps URLs such as
/// <c>?page=12&amp;sort=Amount</c> meaningful across restarts.
/// </summary>
public sealed class TransactionDataset
{
    public const int DefaultCount = 100_000;
    public const int MaxCount = 500_000;

    private static readonly string[] Categories = ["Groceries", "Travel", "Dining", "Software", "Utilities", "Hardware", "Health", "Entertainment"];
    private static readonly string[] Countries = ["GB", "US", "DE", "FR", "ES", "NL", "SE", "JP"];
    private static readonly string[][] MerchantsByCategory =
    [
        ["FreshMart", "GreenGrocer", "Daily Basket", "Corner Store"],
        ["SkyJet Airlines", "RailEurope", "CityCab", "Harbor Hotels"],
        ["Pasta Bar", "Noodle House", "Bean & Leaf", "Smoke Pit BBQ"],
        ["CloudIDE Pro", "Pixel Studio", "Git Hosting Co", "Note Cloud"],
        ["Volt Energy", "AquaFlow", "FiberNet", "MobileOne"],
        ["Byte Electronics", "Keyboard Guild", "Monitor World", "Cable Depot"],
        ["Wellness Pharmacy", "City Dental", "Gym Collective", "Vision Care"],
        ["StreamFlix", "Concert Hall", "Indie Cinema", "Arcade Club"],
    ];
    private static readonly string[] Notes =
    [
        "Split with team; reimbursement requested.",
        "Customer says the charge appeared twice. Waiting for the merchant's response before deciding whether to refund or close the dispute.",
        "Annual plan.",
        "Foreign currency conversion applied by the card network at the daily reference rate plus a 1.5% fee, shown separately on the statement.",
        "Receipt attached.",
    ];

    public TransactionDataset(int count = DefaultCount)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(count, 1);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(count, MaxCount);
        Items = Generate(count);
    }

    public IReadOnlyList<Transaction> Items { get; }

    public int Count => Items.Count;

    public static IReadOnlyList<string> AllCategories => Categories;

    private static Transaction[] Generate(int count)
    {
        var rng = new SplitMix64(0x5EED_2026_1111UL);
        var start = new DateOnly(2026, 1, 1);
        var result = new Transaction[count];
        for (var i = 0; i < count; i++)
        {
            var category = (int)rng.Next(Categories.Length);
            var merchants = MerchantsByCategory[category];
            var status = rng.Next(100) switch { < 85 => TransactionStatus.Settled, < 94 => TransactionStatus.Pending, < 98 => TransactionStatus.Refunded, _ => TransactionStatus.Disputed };
            var amount = Math.Round((decimal)(Math.Exp(rng.NextDouble() * 7.5) - 0.5) + 1m, 2); // long-tailed, 0.50 .. ~1800
            var note = rng.Next(100) < 12 ? Notes[rng.Next(Notes.Length)] : null;
            result[i] = new Transaction(
                Id: i + 1,
                Date: start.AddDays((int)(i * 365L / count)),
                Merchant: merchants[rng.Next(merchants.Length)],
                Category: Categories[category],
                Country: Countries[rng.Next(Countries.Length)],
                Amount: status == TransactionStatus.Refunded ? -amount : amount,
                Status: status,
                Reference: $"TX-{i + 1:D6}-{rng.Next(36 * 36 * 36):X4}",
                Note: note);
        }
        return result;
    }

    /// <summary>SplitMix64: tiny, fast and fully specified, so the sequence is stable forever.</summary>
    private struct SplitMix64(ulong seed)
    {
        private ulong _state = seed;

        public ulong NextUInt64()
        {
            var z = _state += 0x9E3779B97F4A7C15UL;
            z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
            z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
            return z ^ (z >> 31);
        }

        public int Next(int exclusiveMax) => (int)(NextUInt64() % (ulong)exclusiveMax);

        public double NextDouble() => (NextUInt64() >> 11) * (1.0 / (1UL << 53));
    }
}
