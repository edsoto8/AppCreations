using DotNet11Lab.Core.Labs.CSharp15;

namespace DotNet11Lab.Tests.Lab1CSharp15;

public class ClosedHierarchyTests
{
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static readonly TimeProvider Clock = new FixedClock(new DateTimeOffset(2026, 11, 12, 10, 30, 15, TimeSpan.Zero));

    [Fact]
    public void Happy_path_goes_draft_to_shipped()
    {
        var session = new OrderSession(Clock);

        Assert.True(session.Execute(new AddLine()));
        Assert.True(session.Execute(new Submit()));
        Assert.True(session.Execute(new Pay(129.90m)));
        Assert.True(session.Execute(new Ship("ups")));

        var shipped = Assert.IsType<Shipped>(session.State);
        Assert.Equal("UPS-103015", shipped.TrackingNumber[..10]);
        Assert.Empty(OrderStateMachine.AllowedCommands(session.State));
    }

    [Fact]
    public void Invalid_transitions_are_rejected_and_state_is_kept()
    {
        var session = new OrderSession(Clock);

        Assert.False(session.Execute(new Submit()));              // empty order
        Assert.False(session.Execute(new Ship("dhl")));           // not paid
        Assert.IsType<Draft>(session.State);
        Assert.All(session.History, h => Assert.False(h.Accepted));
    }

    [Fact]
    public void Cancel_from_paid_mentions_refund()
    {
        var session = new OrderSession(Clock);
        session.Execute(new AddLine());
        session.Execute(new Submit());
        session.Execute(new Pay(50m));
        session.Execute(new Cancel("Customer request"));

        var cancelled = Assert.IsType<Cancelled>(session.State);
        Assert.Equal(nameof(Paid), cancelled.CancelledFrom);
        Assert.Contains("refund", cancelled.Reason, StringComparison.Ordinal);
    }

    [Fact]
    public void Non_positive_payment_is_rejected()
    {
        var result = OrderStateMachine.Apply(new Submitted(1, Clock.GetUtcNow()), new Pay(0), Clock);
        Assert.IsType<TransitionRejected>(result.Value);
    }

    [Fact]
    public void Closed_type_is_abstract_and_lists_its_derived_types()
    {
        var (isAbstract, derived) = OrderStateMachine.Describe(typeof(OrderState));

        Assert.True(isAbstract);
        Assert.Equal(["Draft", "Submitted", "Paid", "Shipped", "Cancelled"], derived);
    }

    [Fact]
    public void Legacy_and_closed_allowed_commands_agree()
    {
        Assert.Equal(LegacyOrderStateMachine.AllowedCommands(new LegacyDraft(0)), OrderStateMachine.AllowedCommands(new Draft(0)));
        Assert.Equal(LegacyOrderStateMachine.AllowedCommands(new LegacyPaid(1)), OrderStateMachine.AllowedCommands(new Paid(1, "x")));
    }
}

public class CollectionArgumentTests
{
    [Fact]
    public void Sku_dedupe_ignores_case_and_whitespace()
    {
        var result = CollectionArguments.Dedupe("KB-01, kb-01 ,MS-07\nms-07;MN-27");

        Assert.Equal(3, result.Unique.Count);
        Assert.Equal(5, result.CaseSensitiveUnique.Count);
        Assert.Equal(CollectionArguments.LegacyUniqueSkus(result.Input).Order(), CollectionArguments.UniqueSkus(result.Input).Order());
    }

    [Fact]
    public void With_passes_comparer_and_capacity_to_the_constructor()
    {
        var set = CollectionArguments.CustomerIds(["c-1", "C-1", "c-2"], 100);

        Assert.Equal(2, set.Count);
        Assert.Same(StringComparer.OrdinalIgnoreCase, set.Comparer);
        Assert.True(set.Capacity >= 100);
    }

    [Fact]
    public void Presized_list_has_requested_capacity_and_allocates_less_than_growing()
    {
        var comparison = CollectionArguments.CompareCapacity(1_000, 1_000, 2, TestContext.Current.CancellationToken);
        var byCode = comparison.Variants.ToDictionary(v => v.Code);

        Assert.Equal(1_000, byCode["[with(capacity: n), .. query]"].Capacity);
        Assert.Equal(1_000, byCode["new List(n) + AddRange"].Capacity);
        Assert.Equal(1_024, byCode["new List() + Add loop"].Capacity);
        Assert.True(byCode["[with(capacity: n), .. query]"].Measurement.AllocatedBytes < byCode["new List() + Add loop"].Measurement.AllocatedBytes);
    }

    [Fact]
    public void Capacity_hint_leaves_headroom_for_later_adds()
    {
        var list = CollectionArguments.LinesPresized([1m, 2m], 50);
        Assert.Equal(50, list.Capacity);
        Assert.Equal(2, list.Count);
    }
}

public class ExtensionIndexerTests
{
    [Fact]
    public void String_indexer_finds_lines_case_insensitively()
    {
        var order = SampleOrders.Create();

        Assert.Equal("Ergonomic mouse", order["ms-erg-07"]?.Description);
        Assert.Null(order["NOPE"]);
        Assert.Same(order.GetLine("MS-ERG-07"), order["MS-ERG-07"]);
    }

    [Fact]
    public void Index_overload_supports_hat_operator()
    {
        var order = SampleOrders.Create();
        Assert.Equal("CB-USBC-2M", order[^1].Sku);
    }

    [Fact]
    public void Instance_indexer_wins_over_extension_indexer()
    {
        var pick = new PickList(["A", "B"]);
        Assert.Equal("instance indexer → B", pick[1]);
    }
}

public class LabeledLoopTests
{
    [Theory]
    [InlineData(10, 10, 1, "MN-27-4K", 30)]
    [InlineData(50, 40, 7, "DK-TB4", 39)]
    [InlineData(5, 5, 3, "DK-TB4", 1_000)]   // nothing can satisfy this
    public void Labeled_break_and_flag_version_agree(int aisles, int shelves, int seed, string sku, int needed)
    {
        var warehouse = new Warehouse(aisles, shelves, seed);

        var labeled = LabeledLoops.FindBin(warehouse.Bins, sku, needed);
        var legacy = LabeledLoops.LegacyFindBin(warehouse.Bins, sku, needed);

        Assert.Equal(legacy, labeled);
        if (!labeled.Found) Assert.Equal(aisles * shelves, labeled.BinsInspected);
        else Assert.Equal(labeled.Aisle * shelves + labeled.Shelf + 1, labeled.BinsInspected);
    }

    [Fact]
    public void Labeled_continue_skips_the_rest_of_an_invalid_batch()
    {
        IReadOnlyList<IReadOnlyList<LedgerTransaction>> batches =
        [
            [new(1, "A", 10m), new(1, "B", 20m)],
            [new(2, "C", 0m), new(2, "D", 5m), new(2, "E", 5m)],   // first tx invalid: D and E never inspected
            [new(3, "F", 1m)],
        ];

        var result = LabeledLoops.PostBatches(batches);

        Assert.Equal([1, 3], result.PostedBatches);
        Assert.Equal([2], result.RejectedBatches);
        Assert.Equal(4, result.TransactionsInspected);
        Assert.Equal(3, result.TransactionsPosted);
    }

    [Fact]
    public void Labeled_continue_and_goto_versions_agree_on_generated_batches()
    {
        var batches = LabeledLoops.GenerateBatches(100, 20, 3, seed: 42);

        var a = LabeledLoops.PostBatches(batches);
        var b = LabeledLoops.LegacyPostBatches(batches);

        Assert.Equal(b.PostedBatches, a.PostedBatches);
        Assert.Equal(b.RejectedBatches, a.RejectedBatches);
        Assert.Equal(b.TransactionsInspected, a.TransactionsInspected);
        Assert.True(a.RejectedBatches.Count > 0);
    }
}
