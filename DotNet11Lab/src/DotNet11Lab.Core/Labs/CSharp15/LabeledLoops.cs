namespace DotNet11Lab.Core.Labs.CSharp15;

public readonly record struct Bin(string Sku, int Quantity);

public sealed record BinSearchResult(int Aisle, int Shelf, int BinsInspected, bool Found);

public sealed record LedgerTransaction(int Batch, string Reference, decimal Amount);

public sealed record BatchRunResult(IReadOnlyList<int> PostedBatches, IReadOnlyList<int> RejectedBatches, int TransactionsInspected, int TransactionsPosted);

/// <summary>A deterministic warehouse: aisles × shelves of bins, each holding one SKU.</summary>
public sealed class Warehouse
{
    public const int MaxAisles = 200, MaxShelves = 200;
    public static readonly string[] Skus = ["KB-MX-01", "MS-ERG-07", "MN-27-4K", "CB-USBC-2M", "HD-NC-900", "DK-TB4"];

    public Warehouse(int aisles, int shelves, int seed)
    {
        aisles = Math.Clamp(aisles, 1, MaxAisles);
        shelves = Math.Clamp(shelves, 1, MaxShelves);
        var random = new Random(seed);
        Bins = new Bin[aisles][];
        for (var a = 0; a < aisles; a++)
        {
            Bins[a] = new Bin[shelves];
            for (var s = 0; s < shelves; s++)
                Bins[a][s] = new Bin(Skus[random.Next(Skus.Length)], random.Next(0, 40));
        }
    }

    public Bin[][] Bins { get; }
}

public static class LabeledLoops
{
    // <snippet:CSharp15.LabeledBreak>
    public static BinSearchResult FindBin(Bin[][] bins, string sku, int needed)
    {
        var inspected = 0;
        (int Aisle, int Shelf) hit = (-1, -1);

        aisles:
        for (var aisle = 0; aisle < bins.Length; aisle++)
        {
            for (var shelf = 0; shelf < bins[aisle].Length; shelf++)
            {
                inspected++;
                var bin = bins[aisle][shelf];
                if (bin.Sku == sku && bin.Quantity >= needed)
                {
                    hit = (aisle, shelf);
                    break aisles;          // leaves both loops at once
                }
            }
        }
        return new(hit.Aisle, hit.Shelf, inspected, hit.Aisle >= 0);
    }
    // </snippet:CSharp15.LabeledBreak>

    // <snippet:CSharp15.LegacyBreak>
    public static BinSearchResult LegacyFindBin(Bin[][] bins, string sku, int needed)
    {
        var inspected = 0;
        (int Aisle, int Shelf) hit = (-1, -1);
        var found = false;                  // flag variable threaded through both loops

        for (var aisle = 0; aisle < bins.Length && !found; aisle++)
        {
            for (var shelf = 0; shelf < bins[aisle].Length; shelf++)
            {
                inspected++;
                var bin = bins[aisle][shelf];
                if (bin.Sku == sku && bin.Quantity >= needed)
                {
                    hit = (aisle, shelf);
                    found = true;
                    break;                  // only leaves the inner loop
                }
            }
        }
        return new(hit.Aisle, hit.Shelf, inspected, found);
    }
    // </snippet:CSharp15.LegacyBreak>

    // <snippet:CSharp15.LabeledContinue>
    public static BatchRunResult PostBatches(IReadOnlyList<IReadOnlyList<LedgerTransaction>> batches)
    {
        List<int> posted = [], rejected = [];
        var inspected = 0;
        var postedCount = 0;

        batches:
        foreach (var batch in batches)
        {
            foreach (var tx in batch)
            {
                inspected++;
                if (tx.Amount == 0 || string.IsNullOrWhiteSpace(tx.Reference))
                {
                    rejected.Add(tx.Batch);
                    continue batches;       // all-or-nothing: skip the rest of this batch
                }
            }
            posted.Add(batch[0].Batch);
            postedCount += batch.Count;
        }
        return new(posted, rejected, inspected, postedCount);
    }
    // </snippet:CSharp15.LabeledContinue>

    // <snippet:CSharp15.LegacyContinue>
    public static BatchRunResult LegacyPostBatches(IReadOnlyList<IReadOnlyList<LedgerTransaction>> batches)
    {
        List<int> posted = [], rejected = [];
        var inspected = 0;
        var postedCount = 0;

        foreach (var batch in batches)
        {
            foreach (var tx in batch)
            {
                inspected++;
                if (tx.Amount == 0 || string.IsNullOrWhiteSpace(tx.Reference))
                {
                    rejected.Add(tx.Batch);
                    goto NextBatch;         // the C# 14 way to "continue" an outer loop
                }
            }
            posted.Add(batch[0].Batch);
            postedCount += batch.Count;
        NextBatch:;
        }
        return new(posted, rejected, inspected, postedCount);
    }
    // </snippet:CSharp15.LegacyContinue>

    /// <summary>Deterministic batches; roughly <paramref name="invalidPercent"/>% of transactions are invalid.</summary>
    public static IReadOnlyList<IReadOnlyList<LedgerTransaction>> GenerateBatches(int batchCount, int batchSize, int invalidPercent, int seed)
    {
        batchCount = Math.Clamp(batchCount, 1, 500);
        batchSize = Math.Clamp(batchSize, 1, 500);
        invalidPercent = Math.Clamp(invalidPercent, 0, 100);
        var random = new Random(seed);
        var result = new List<IReadOnlyList<LedgerTransaction>>(batchCount);
        for (var b = 1; b <= batchCount; b++)
        {
            var batch = new List<LedgerTransaction>(batchSize);
            for (var i = 0; i < batchSize; i++)
            {
                var invalid = random.Next(100) < invalidPercent;
                batch.Add(new(b, invalid && random.Next(2) == 0 ? "" : $"TX-{b:000}-{i:000}",
                    invalid ? 0m : Math.Round((decimal)(random.NextDouble() * 900 + 10), 2)));
            }
            result.Add(batch);
        }
        return result;
    }
}
