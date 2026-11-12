using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;
using TaskFlow.Core.Services;
using TaskFlow.Core.ViewModels;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public class MainViewModelTests
{
    private readonly FixedTimeProvider _time = new();
    private readonly TaskService _service;
    private readonly MainViewModel _vm;

    public MainViewModelTests()
    {
        _service = new TaskService(_time);
        _vm = new MainViewModel(_service, _time);
    }

    [Fact]
    public async Task AddingTasks_UpdatesListAndCounts()
    {
        await _service.AddAsync(Draft("A"));
        await _service.AddAsync(Draft("B"));

        Assert.Equal(2, _vm.Tasks.Count);
        Assert.Equal(2, _vm.TotalCount);
        Assert.Equal("0 of 2 completed", _vm.SummaryText);
        Assert.False(_vm.IsEmpty);
    }

    [Fact]
    public async Task ToggleCompletedCommand_CompletesAndUncompletes()
    {
        await _service.AddAsync(Draft("A"));
        var item = _vm.Tasks.Single();

        await item.ToggleCompletedCommand.ExecuteAsync(null);
        Assert.True(item.IsCompleted);
        Assert.Equal(1, _vm.CompletedCount);

        await item.ToggleCompletedCommand.ExecuteAsync(null);
        Assert.False(item.IsCompleted);
        Assert.Equal(0, _vm.CompletedCount);
    }

    [Fact]
    public async Task ActiveFilter_HidesTaskOnceCompleted()
    {
        await _service.AddAsync(Draft("A"));
        _vm.SelectedFilter = _vm.FilterChoices.Single(c => c.Value == TaskFilter.Active);

        await _vm.Tasks.Single().ToggleCompletedCommand.ExecuteAsync(null);

        Assert.Empty(_vm.Tasks);
        Assert.True(_vm.IsEmpty);
        Assert.Equal("No active tasks", _vm.EmptyTitle);
    }

    [Fact]
    public async Task ChangingSort_ReordersVisibleTasks()
    {
        await _service.AddAsync(Draft("low-soon", Priority.Low, Today.AddDays(1)));
        await _service.AddAsync(Draft("high-late", Priority.High, Today.AddDays(9)));

        Assert.Equal("low-soon", _vm.Tasks[0].Title);

        _vm.SelectedSort = _vm.SortChoices.Single(c => c.Value == TaskSortOrder.Priority);
        Assert.Equal("high-late", _vm.Tasks[0].Title);
    }

    [Fact]
    public void EmptyStart_ShowsFirstRunMessage()
    {
        Assert.True(_vm.IsEmpty);
        Assert.Equal("No tasks yet", _vm.EmptyTitle);
        Assert.Equal("No tasks yet", _vm.SummaryText);
    }

    [Fact]
    public async Task ItemViewModels_AreReusedAcrossRefreshes()
    {
        await _service.AddAsync(Draft("A"));
        var first = _vm.Tasks.Single();
        await _service.AddAsync(Draft("B"));
        Assert.Contains(first, _vm.Tasks);
    }
}
