# Lab 2 — LINQ joins and the reconciliation tool

Page: `/labs/linq` · Code: `src/DotNet11Lab.Core/Labs/Linq/` · UI: `LinqLab.razor`, `Components/Pages/Labs/Linq/ReconciliationTool.razor`
· Tests: `tests/DotNet11Lab.Tests/Lab2Linq/`

## What's new

| API | Status | Verified |
|---|---|---|
| `Enumerable.FullJoin(outer, inner, outerKey, innerKey, comparer = null)` → `IEnumerable<(TOuter Outer, TInner Inner)>` | New in .NET 11 | Reflection + compiled; tuple elements are named `Outer`/`Inner` and both are nullable-annotated |
| `FullJoin(..., resultSelector, comparer)` | New in .NET 11 | Reflection |
| `Join(outer, inner, outerKey, innerKey, comparer = null)` → `(Outer, Inner)` tuples | New in .NET 11 | Compiled |
| `GroupJoin(outer, inner, outerKey, innerKey, comparer = null)` → **`IEnumerable<IGrouping<TOuter, TInner>>`** | New in .NET 11 | Reflection: it is *not* a tuple; `Key` is the outer element |
| `LeftJoin` / `RightJoin` | .NET 10 (baseline) | Reflection |

## Why it matters

Reconciliation, diffing and synchronization are full outer joins: rows only in A, only in B, and in both all matter.
Before .NET 11 that needed a left join emulated with `GroupJoin` + `SelectMany` + `DefaultIfEmpty`, concatenated with an
anti-join for the right-only rows, which is verbose, easy to get wrong and enumerates one side twice.

## Example

- `Linq.FullJoin`: one `FullJoin` call, then `Classify(bank, ledger)` (`Linq.Classify`) into Matched /
  Amount mismatch / Missing in bank / Missing in ledger.
- `Linq.TupleJoin`: tuple `Join` and the `IGrouping` form of `GroupJoin`.

The **reconciliation tool** generates a bank statement and a general ledger deterministically from a seed
(up to 200 000 transactions) with configurable rates of missing-in-bank, missing-in-ledger, amount mismatches and
double postings, or reconciles CSVs the user pastes/edits (up to 2 000 rows per side, errors reported per line). It shows
metric tiles (totals, match rate, net difference, duplicated references), a bar chart per category, and a paged,
filterable table. Optionally it re-runs the two alternative implementations and checks all three agree row for row.

## Previous approach

- `Linq.LegacyFullJoin`: GroupJoin/SelectMany/DefaultIfEmpty left join + `Concat` of an anti-join.
- `Linq.DictionaryJoin`: hand-rolled `Dictionary<string, List<LedgerEntry>>` + `HashSet` of seen keys.
- `Linq.LegacyTupleJoin`: `Join(..., (b, l) => (b, l))` and the .NET 10 `LeftJoin` baseline.

Duplicate keys: all three produce the cross product of matching rows (like SQL `FULL OUTER JOIN`). The tests check
identical classifications across implementations for hand-built edge cases (duplicates, empty sides, case-sensitive
ordinal keys) and for generated data sets of 1 000 and 20 000 transactions.

## Performance implications

The page measures the three implementations with `Measure.Run` (warm-up + timed iterations, per-thread allocations) at a
user-chosen size up to 100 000 transactions. A typical run on the dev container (20 000 transactions, 10 iterations):
FullJoin allocated the least (~4.4 MB vs ~6.7 MB emulation, ~6.3 MB dictionary) and its time was in the same range
as the alternatives (≈17–22 ms; the hand-rolled dictionary was fastest). These are quick in-process numbers, not
BenchmarkDotNet results; run the demo for your own machine. FullJoin builds a lookup of the inner side and tracks
matched inner groups, so memory is O(inner).

## Production use cases

Month-end close (bank vs ledger), payment-provider settlement files vs orders, inventory counts vs the stock system,
two-way sync between systems of record. `FullJoin` also exists on `Queryable` and `AsyncEnumerable`.

## When not to use

- Only one side's unmatched rows matter: `LeftJoin`/`RightJoin` express that more precisely.
- Non-unique keys where a cross product is wrong: aggregate or deduplicate first.
- Data in a database: let the provider run the join (check that it translates `FullJoin`).

## Docs

- [Enumerable.FullJoin](https://learn.microsoft.com/dotnet/api/system.linq.enumerable.fulljoin)
- [What's new in .NET 11 libraries](https://learn.microsoft.com/dotnet/core/whats-new/dotnet-11/libraries)
- [Join operations in LINQ](https://learn.microsoft.com/dotnet/csharp/linq/standard-query-operators/join-operations)
