using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;

namespace BoardFlow.Tests.Core;

public sealed class CardFilterTests
{
    private static readonly DateOnly Today = new(2026, 3, 10);

    private static Card MakeCard(
        string title = "Card",
        string description = "",
        Priority priority = Priority.None,
        DateOnly? due = null,
        long columnId = 1,
        long[]? labels = null) => new()
    {
        Id = 1,
        ColumnId = columnId,
        Title = title,
        Description = description,
        Priority = priority,
        DueDate = due,
        LabelIds = [.. labels ?? []],
    };

    [Fact]
    public void EmptyFilter_IsEmptyAndMatchesEverything()
    {
        var filter = new CardFilter();
        Assert.True(filter.IsEmpty);
        Assert.True(CardFilter.None.IsEmpty);
        Assert.True(filter.Matches(MakeCard(), Today));
        Assert.True(filter.Matches(MakeCard("x", "y", Priority.Critical, Today.AddDays(-30), 9, [1, 2]), Today));
    }

    [Fact]
    public void WhitespaceOnlySearch_CountsAsEmpty()
    {
        var filter = new CardFilter { SearchText = " \t  " };
        Assert.True(filter.IsEmpty);
        Assert.True(filter.Matches(MakeCard("anything"), Today));
    }

    [Fact]
    public void AnyActiveCategory_MakesTheFilterNonEmpty()
    {
        Assert.False(new CardFilter { SearchText = "text" }.IsEmpty);
        Assert.False(new CardFilter { Priorities = new HashSet<Priority> { Priority.Low } }.IsEmpty);
        Assert.False(new CardFilter { LabelIds = new HashSet<long> { 1 } }.IsEmpty);
        Assert.False(new CardFilter { ColumnIds = new HashSet<long> { 1 } }.IsEmpty);
        Assert.False(new CardFilter { Due = DueFilter.Overdue }.IsEmpty);
    }

    [Fact]
    public void Search_MatchesTitleCaseInsensitively()
    {
        var filter = new CardFilter { SearchText = "KITCHEN" };
        Assert.True(filter.Matches(MakeCard("Fix the kitchen sink"), Today));
        Assert.False(filter.Matches(MakeCard("Fix the bathroom sink"), Today));
    }

    [Fact]
    public void Search_MatchesDescription()
    {
        var filter = new CardFilter { SearchText = "plumber" };
        Assert.True(filter.Matches(MakeCard("Sink", "Call the Plumber tomorrow"), Today));
    }

    [Fact]
    public void Search_RequiresEveryTerm()
    {
        var filter = new CardFilter { SearchText = "fix sink" };
        Assert.True(filter.Matches(MakeCard("Fix the kitchen sink"), Today));
        Assert.False(filter.Matches(MakeCard("Fix the door"), Today));
        Assert.False(filter.Matches(MakeCard("Clean the sink"), Today));
    }

    [Fact]
    public void Search_TermsMayBeSplitAcrossTitleAndDescription()
    {
        var filter = new CardFilter { SearchText = "fix sink" };
        Assert.True(filter.Matches(MakeCard("Fix it", "the sink drips"), Today));
    }

    [Fact]
    public void Search_TermsAreSeparatedByAnyWhitespace()
    {
        var filter = new CardFilter { SearchText = "  fix \t  sink " };
        Assert.True(filter.Matches(MakeCard("Fix the sink"), Today));
    }

    [Fact]
    public void Priority_MatchesAnyOfTheSelectedValues()
    {
        var filter = new CardFilter { Priorities = new HashSet<Priority> { Priority.High, Priority.Critical } };
        Assert.True(filter.Matches(MakeCard(priority: Priority.High), Today));
        Assert.True(filter.Matches(MakeCard(priority: Priority.Critical), Today));
        Assert.False(filter.Matches(MakeCard(priority: Priority.Medium), Today));
        Assert.False(filter.Matches(MakeCard(priority: Priority.None), Today));
    }

    [Fact]
    public void Priority_NoneCanBeSelectedExplicitly()
    {
        var filter = new CardFilter { Priorities = new HashSet<Priority> { Priority.None } };
        Assert.True(filter.Matches(MakeCard(priority: Priority.None), Today));
        Assert.False(filter.Matches(MakeCard(priority: Priority.Low), Today));
    }

    [Fact]
    public void Labels_MatchWhenTheCardHasAtLeastOneSelectedLabel()
    {
        var filter = new CardFilter { LabelIds = new HashSet<long> { 5, 6 } };
        Assert.True(filter.Matches(MakeCard(labels: [5]), Today));
        Assert.True(filter.Matches(MakeCard(labels: [1, 6]), Today));
        Assert.True(filter.Matches(MakeCard(labels: [5, 6]), Today));
        Assert.False(filter.Matches(MakeCard(labels: [1, 2]), Today));
        Assert.False(filter.Matches(MakeCard(), Today));
    }

    [Fact]
    public void Column_MatchesOnlySelectedColumns()
    {
        var filter = new CardFilter { ColumnIds = new HashSet<long> { 2, 3 } };
        Assert.True(filter.Matches(MakeCard(columnId: 2), Today));
        Assert.True(filter.Matches(MakeCard(columnId: 3), Today));
        Assert.False(filter.Matches(MakeCard(columnId: 1), Today));
    }

    [Theory]
    [InlineData(DueFilter.Any, -5, true)]
    [InlineData(DueFilter.Any, null, true)]
    [InlineData(DueFilter.Overdue, -1, true)]
    [InlineData(DueFilter.Overdue, 0, false)]
    [InlineData(DueFilter.Overdue, 3, false)]
    [InlineData(DueFilter.Overdue, null, false)]
    [InlineData(DueFilter.DueToday, 0, true)]
    [InlineData(DueFilter.DueToday, -1, false)]
    [InlineData(DueFilter.DueToday, 1, false)]
    [InlineData(DueFilter.DueToday, null, false)]
    [InlineData(DueFilter.DueThisWeek, -1, false)]
    [InlineData(DueFilter.DueThisWeek, 0, true)]
    [InlineData(DueFilter.DueThisWeek, 7, true)]
    [InlineData(DueFilter.DueThisWeek, 8, false)]
    [InlineData(DueFilter.DueThisWeek, null, false)]
    [InlineData(DueFilter.HasDueDate, -100, true)]
    [InlineData(DueFilter.HasDueDate, 0, true)]
    [InlineData(DueFilter.HasDueDate, 100, true)]
    [InlineData(DueFilter.HasDueDate, null, false)]
    [InlineData(DueFilter.NoDueDate, null, true)]
    [InlineData(DueFilter.NoDueDate, 0, false)]
    [InlineData(DueFilter.NoDueDate, -1, false)]
    public void Due_FiltersByDueState(DueFilter due, int? offsetDays, bool expected)
    {
        var filter = new CardFilter { Due = due };
        var card = MakeCard(due: offsetDays is { } days ? Today.AddDays(days) : null);
        Assert.Equal(expected, filter.Matches(card, Today));
    }

    [Fact]
    public void Categories_AreCombinedWithAnd()
    {
        var filter = new CardFilter
        {
            SearchText = "report",
            Priorities = new HashSet<Priority> { Priority.High },
            LabelIds = new HashSet<long> { 7 },
            ColumnIds = new HashSet<long> { 2 },
            Due = DueFilter.DueThisWeek,
        };

        var match = MakeCard("Quarterly report", "", Priority.High, Today.AddDays(2), 2, [7, 8]);
        Assert.True(filter.Matches(match, Today));

        // Failing exactly one category must reject the card.
        Assert.False(filter.Matches(MakeCard("Quarterly summary", "", Priority.High, Today.AddDays(2), 2, [7]), Today));
        Assert.False(filter.Matches(MakeCard("Quarterly report", "", Priority.Low, Today.AddDays(2), 2, [7]), Today));
        Assert.False(filter.Matches(MakeCard("Quarterly report", "", Priority.High, Today.AddDays(2), 2, [8]), Today));
        Assert.False(filter.Matches(MakeCard("Quarterly report", "", Priority.High, Today.AddDays(2), 3, [7]), Today));
        Assert.False(filter.Matches(MakeCard("Quarterly report", "", Priority.High, Today.AddDays(20), 2, [7]), Today));
    }

    [Fact]
    public void Filtering_AListKeepsOnlyMatches()
    {
        var cards = new[]
        {
            MakeCard("Buy milk", priority: Priority.Low),
            MakeCard("Buy bread", priority: Priority.High),
            MakeCard("Call bank", priority: Priority.High),
        };
        var filter = new CardFilter { SearchText = "buy", Priorities = new HashSet<Priority> { Priority.High } };

        var titles = cards.Where(c => filter.Matches(c, Today)).Select(c => c.Title).ToList();

        Assert.Equal(["Buy bread"], titles);
    }
}
