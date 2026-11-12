# Lab 1 — C# 15 language features

Page: `/labs/csharp15` · Code: `src/DotNet11Lab.Core/Labs/CSharp15/` · UI: `src/DotNet11Lab.Web/Components/Pages/Labs/CSharp15/`
· Tests: `tests/DotNet11Lab.Tests/Lab1CSharp15/`

All five features are **stable** in C# 15, the default language version for `net11.0` (the repo pins
`LangVersion 15`). None needs `LangVersion preview`. Every statement below was checked by compiling or running code
against SDK 11.0.100; the snippets referenced are embedded from the compiled assembly and shown on the page.

---

## 1. Union types

**What's new.** `public union PaymentResult(PaymentApproved, PaymentDeclined, PaymentPending);` declares a value that is
exactly one of a closed list of case types. The case types need no common base type.

**Why it matters.** Operations with several legitimate outcomes (approve / decline / review) can return one type whose
case list the compiler knows. A `switch` that handles every case needs no `_` arm, and adding a case produces CS8509
at every incomplete switch instead of a runtime exception.

**Example.** `CSharp15.PaymentCases`, `CSharp15.ProcessPayment` (implicit conversions from each case),
`CSharp15.DescribePayment` (exhaustive switch with an explicit `null` arm).

**Previous approach.** `CSharp15.LegacyPayment`: an abstract record base class plus a mandatory
`_ => throw new ArgumentOutOfRangeException(...)` arm (or a OneOf-style library wrapper).

**Observed facts (the "What did the compiler generate?" demo runs these at runtime).**

| Fact | Result |
|---|---|
| `typeof(PaymentResult).IsValueType` | `True`: unions lower to a struct |
| implements `System.Runtime.CompilerServices.IUnion`, marked `[Union]` | `True` / `True` |
| one public constructor per case type | `PaymentApproved, PaymentDeclined, PaymentPending` |
| `result is PaymentApproved` | tests the **contained value** |
| `default(PaymentResult).Value` | `null`; `default(PaymentResult) is not null` is `False` |
| switch without a `null` arm on `default` | compiles with no warning (all cases non-nullable) and throws `SwitchExpressionException` |

**System.Text.Json.** Serializing writes the active case only, with no wrapper or discriminator
(`{"DeclineCode":"D-51","Reason":"Insufficient funds"}`; `default` → `null`). Deserializing a union whose cases are all
JSON objects fails with `JsonException: JSON value type 'Object' is ambiguous for union type ...`. Adding
`[JsonUnion(TypeClassifier = typeof(JsonUnionTypeStructuralClassifier))]` (`CSharp15.JsonUnion`) selects the case by
property names, which works because the three shapes are distinguishable; an unknown shape still throws. The page runs
both versions live against editable JSON (`CSharp15.JsonUnionRoundTrip`).

**Performance.** The union is a struct holding one `object?`: reference-type cases cost nothing extra, value-type cases
are boxed. Pattern matching is type tests on `Value`.

**Production use cases.** Payment/command results, `Result<T, Error>`-style APIs, API responses that are one of several
DTOs (ASP.NET Core 11 emits OpenAPI `anyOf`).

**When not to use.** Cases that share data or behaviour (use a closed hierarchy); value-type cases on hot paths (boxing);
JSON contracts with overlapping object shapes (needs a custom classifier).

Docs: [Union types](https://learn.microsoft.com/dotnet/csharp/language-reference/builtin-types/union) ·
[Unions proposal](https://learn.microsoft.com/dotnet/csharp/language-reference/proposals/csharp-15.0/unions) ·
[Union types in System.Text.Json](https://learn.microsoft.com/dotnet/standard/serialization/system-text-json/union-types)

---

## 2. Closed hierarchies

**What's new.** `public closed record OrderState;` makes the class implicitly abstract and restricts derived types to the
declaring assembly. The compiler records the list (`[IsClosedType(DerivedTypes = [...])]`, read by reflection on the page).

**Why it matters.** State machines and event hierarchies get exhaustive `switch` expressions without a default arm,
while still sharing a base type.

**Example.** `CSharp15.OrderStates` (Draft / Submitted / Paid / Shipped / Cancelled and a closed `OrderCommand`
hierarchy), `CSharp15.Transition` (nested exhaustive switches returning a `TransitionResult` union of the next
`OrderState` or a `TransitionRejected`). The page has an interactive stepper with a transition history.

**Previous approach.** `CSharp15.LegacyOrderStates`: `abstract record` plus `_ => throw new UnreachableException()`.

**Rules verified.** `closed abstract` is error CS9384; `closed` cannot be combined with `sealed`/`static`; derived types
must be in the same assembly; closedness is not transitive.

**Performance.** None at runtime: it is a compile-time contract (plus an attribute).

**Production use cases.** Order/invoice/application lifecycles, domain events, library types consumers may match on but
not extend. System.Text.Json can infer polymorphism from the closed list (Lab 6).

**When not to use.** Plug-in extensibility across assemblies; unrelated case types (use a union).

Docs: [closed modifier](https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/closed) ·
[What's new in C# 15](https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-15)

---

## 3. Collection expression arguments

**What's new.** A leading `with(...)` element passes arguments to the collection's constructor or builder:
`HashSet<string> s = [with(StringComparer.OrdinalIgnoreCase), .. codes];`,
`List<decimal> l = [with(capacity: n), .. query];`, `[with(capacity: n, comparer: c), ..]`.

**Example.** `CSharp15.DedupeSkus` (case-insensitive SKU dedupe, interactive) and `CSharp15.PresizedList`.
**Previous approach.** `CSharp15.LegacyDedupeSkus`, `CSharp15.LegacyPresizedList` (constructor + loop / `AddRange`).

**Verified by compiling.**
- Works for `List<T>`, `HashSet<T>`, `SortedSet<T>` and builder types such as `ImmutableHashSet<T>`.
- **Does not work for `Dictionary<TKey, TValue>`**: CS9215 (the type needs an accessible single-argument `Add`).

**Performance (measured on the page with `Measure.Run`).** For a lazy query of 50 000 items, `[with(capacity: n), ..]`
and `new List(n) + AddRange` allocate about the same as `[.. query]` (~780 KB), while `new List() + Add` grows by
doubling (~2 MB, capacity 65 536). Note that `[.. query]` already avoids repeated growth by buffering and copying into an
exact-size list; the capacity hint's extra value is a single final allocation and headroom for later `Add` calls.

**When not to use.** Sources with a known count (the compiler presizes anyway); guessed capacities; dictionaries.

Docs: [Collection expression arguments](https://learn.microsoft.com/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments)

---

## 4. Extension indexers

**What's new.** `extension(CustomerOrder order) { public OrderLine? this[string sku] => ...; }` adds an indexer to a type
you do not own (receiver parameter must be named). Overloads work (`this[Index]` for `order[^1]`).

**Example.** `CSharp15.ExtensionIndexer`. **Previous approach.** `CSharp15.LegacyExtensionIndexer` (`order.GetLine(sku)`).

**Instance indexer wins.** `PickList` has `this[int]`; an extension `this[int]` is never chosen for `pickList[1]`
(demonstrated live and in tests). Observed: an extension indexer *is* used when the receiver's instance indexers are
not applicable to the argument type (e.g. `IReadOnlyList<int>` / `List<int>` with an extension `this[string]`).

**Performance.** Same as the equivalent extension method call.

**When not to use.** Expensive lookups (indexer syntax implies cheap access); receivers that already have a compatible
indexer.

Docs: [Extension indexers](https://learn.microsoft.com/dotnet/csharp/language-reference/keywords/extension#extension-indexers)

---

## 5. Labeled `break` / `continue`

**What's new.** A label on a loop can be the target of `break label;` and `continue label;`.

**Example.** `CSharp15.LabeledBreak` (find the first warehouse bin with enough stock, leaving both loops) and
`CSharp15.LabeledContinue` (reject a ledger batch as soon as one transaction is invalid).
**Previous approach.** `CSharp15.LegacyBreak` (flag variable) and `CSharp15.LegacyContinue` (`goto`).

**Performance.** Identical: both versions inspect exactly the same number of bins/transactions (the page and the tests
compare the counts). The gain is readability and fewer mutable flags.

**When not to use.** Several labels in deep nesting (extract a method); simple searches that read better as LINQ.

Docs: [What's new in C# 15](https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-15) ·
[Jump statements](https://learn.microsoft.com/dotnet/csharp/language-reference/statements/jump-statements)
