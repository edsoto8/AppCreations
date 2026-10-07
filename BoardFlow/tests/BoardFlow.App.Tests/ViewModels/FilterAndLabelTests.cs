using Avalonia.Headless.XUnit;
using BoardFlow.App.ViewModels;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using BoardFlow.Tests.App.Support;

namespace BoardFlow.Tests.App.ViewModels;

public sealed class FilterAndLabelTests
{
    private static async Task<(TestSession S, Label Bug)> BoardWithCards()
    {
        var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var bug = s.Labels.Create(s.Main.SelectedWorkspace!.Id, "Bug", "#E5534B");
        var cols = s.Board.Columns;
        var today = s.Clock.Today;
        s.Cards.Create(cols[0].Id, new CardInput("Login crash", "Stack trace attached", Priority.Critical, today.AddDays(-2), [bug.Id]));
        s.Cards.Create(cols[0].Id, new CardInput("Write docs", "Install guide", Priority.Low));
        s.Cards.Create(cols[1].Id, new CardInput("Fix typo", "login page", Priority.Low, today, [bug.Id]));
        s.Cards.Create(cols[2].Id, new CardInput("Plan sprint", "", Priority.Medium, today.AddDays(20)));
        s.Board.Reload();
        return (s, bug);
    }

    private static string[] Visible(BoardViewModel board) =>
        board.Columns.SelectMany(c => c.Cards).Select(c => c.Title).ToArray();

    [AvaloniaFact]
    public async Task Search_MatchesTitleAndDescription_AndUpdatesSummary()
    {
        var (s, _) = await BoardWithCards();
        using var _s = s;

        s.Board.SearchText = "login";
        Assert.Equal(["Login crash", "Fix typo"], Visible(s.Board));
        Assert.True(s.Board.IsFilterActive);
        Assert.Equal("Showing 2 of 4 cards", s.Board.FilterSummary);
        Assert.Equal("1 of 2", s.Board.Columns[0].CountText);
    }

    [AvaloniaFact]
    public async Task CombinedFilters_ThenClear_RestoresFullBoard()
    {
        var (s, bug) = await BoardWithCards();
        using var _s = s;

        s.Board.PriorityOptions.Single(o => o.Name == "Low").IsSelected = true;
        Assert.Equal(["Write docs", "Fix typo"], Visible(s.Board));

        s.Board.LabelOptions.Single(o => o.Key == bug.Id).IsSelected = true;
        Assert.Equal(["Fix typo"], Visible(s.Board));
        Assert.Equal(2, s.Board.ActiveFilterCount);
        Assert.Equal("Filter (2)", s.Board.FilterButtonText);

        s.Board.ClearFilters();
        Assert.Equal(["Login crash", "Write docs", "Fix typo", "Plan sprint"], Visible(s.Board));
        Assert.False(s.Board.IsFilterActive);
        Assert.All(s.Board.Columns, c => Assert.True(c.IsVisible));
    }

    [AvaloniaFact]
    public async Task DueFilters_Overdue_Today_NoDate()
    {
        var (s, _) = await BoardWithCards();
        using var _s = s;

        s.Board.SelectedDue = s.Board.DueOptions.Single(o => o.Value == DueFilter.Overdue);
        Assert.Equal(["Login crash"], Visible(s.Board));
        s.Board.SelectedDue = s.Board.DueOptions.Single(o => o.Value == DueFilter.DueToday);
        Assert.Equal(["Fix typo"], Visible(s.Board));
        s.Board.SelectedDue = s.Board.DueOptions.Single(o => o.Value == DueFilter.NoDueDate);
        Assert.Equal(["Write docs"], Visible(s.Board));
    }

    [AvaloniaFact]
    public async Task ColumnFilter_ShowsOnlySelectedColumns()
    {
        var (s, _) = await BoardWithCards();
        using var _s = s;

        s.Board.ColumnOptions.Single(o => o.Name == "Todo").IsSelected = true;

        Assert.Equal(["Todo"], s.Board.Columns.Where(c => c.IsVisible).Select(c => c.Name));
        Assert.Equal(["Fix typo"], Visible(s.Board));
    }

    [AvaloniaFact]
    public async Task FiltersSurviveReload_AndNewCardsHiddenByFilterAreReported()
    {
        var (s, _) = await BoardWithCards();
        using var _s = s;
        s.Board.SearchText = "crash";

        s.Board.QuickAdd(s.Board.Columns[0], "Unrelated");

        Assert.Equal(["Login crash"], Visible(s.Board));
        Assert.Contains("hidden by the current filter", s.Main.Notifier.Message);
        Assert.Equal(5, s.Board.TotalCards);
    }

    [AvaloniaFact]
    public async Task LabelsPanel_CreateRenameDelete_UpdatesBoard()
    {
        var (s, bug) = await BoardWithCards();
        using var _s = s;
        await s.Main.ManageLabelsCommand.ExecuteAsync(null);
        var labels = Assert.IsType<LabelsViewModel>(s.Main.Panels.Current);

        labels.NewName = "Design";
        labels.AddCommand.Execute(null);
        Assert.Equal(["Bug", "Design"], labels.Labels.Select(l => l.Name));
        Assert.Equal(2, s.Board.LabelOptions.Count);

        var row = labels.Labels.Single(l => l.Id == bug.Id);
        Assert.Equal("2 cards", row.UsageText);
        row.Name = "Defect";
        Assert.True(row.IsChanged);
        labels.SaveCommand.Execute(row);
        Assert.Contains(s.Board.Columns[0].Cards[0].Labels, l => l.Name == "Defect");

        labels.NewName = "defect";
        labels.AddCommand.Execute(null);
        Assert.True(s.Main.Notifier.IsError);

        await s.RunWithDialog(() => labels.DeleteCommand.ExecuteAsync(labels.Labels.Single(l => l.Id == bug.Id)), d => d.Confirm());
        Assert.Equal(["Design"], labels.Labels.Select(l => l.Name));
        Assert.Equal(4, s.Board.TotalCards);
        Assert.All(s.Board.Columns.SelectMany(c => c.Cards), c => Assert.Empty(c.Labels));
    }
}
