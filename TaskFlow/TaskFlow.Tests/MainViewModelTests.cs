using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;
using TaskFlow.Core.Services;
using TaskFlow.Core.ViewModels;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public class MainViewModelTests
{
    private readonly FixedTimeProvider _time = new();
    private readonly FakeTaskStore _store = new();
    private readonly FakeNavigation _navigation = new();
    private readonly FakeDialogs _dialogs = new();
    private readonly TaskService _service;
    private readonly MainViewModel _vm;

    public MainViewModelTests()
    {
        _service = Services.LoadedTaskService(_store, _time);
        _vm = new MainViewModel(_service, _navigation, _dialogs, _time);
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

    [Fact]
    public void AddTaskCommand_OpensEmptyEditor()
    {
        _vm.AddTaskCommand.Execute(null);
        Assert.Equal([null], _navigation.OpenedEditors);
    }

    [Fact]
    public async Task EditCommand_OpensEditorForThatTask()
    {
        var task = await _service.AddAsync(Draft("A"));
        _vm.Tasks.Single().EditCommand.Execute(null);
        Assert.Equal([task.Id], _navigation.OpenedEditors);
    }

    [Fact]
    public async Task DeleteCommand_Confirmed_RemovesTask()
    {
        await _service.AddAsync(Draft("A"));
        _dialogs.Answer = true;

        await _vm.Tasks.Single().DeleteCommand.ExecuteAsync(null);

        Assert.Equal(1, _dialogs.AskCount);
        Assert.Empty(_service.Tasks);
        Assert.Empty(_vm.Tasks);
    }

    [Fact]
    public async Task DeleteCommand_Cancelled_KeepsTask()
    {
        await _service.AddAsync(Draft("A"));
        _dialogs.Answer = false;

        await _vm.Tasks.Single().DeleteCommand.ExecuteAsync(null);

        Assert.Single(_service.Tasks);
        Assert.Single(_vm.Tasks);
    }

    [Fact]
    public async Task DueDateText_And_Overdue_UseTodaysDate()
    {
        await _service.AddAsync(Draft("late", due: Today.AddDays(-3)));
        await _service.AddAsync(Draft("today", due: Today));

        var late = _vm.Tasks.Single(t => t.Title == "late");
        var today = _vm.Tasks.Single(t => t.Title == "today");

        Assert.True(late.IsOverdue);
        Assert.False(late.ShowRegularDueDate);
        Assert.StartsWith("Overdue · ", late.OverdueText);
        Assert.False(today.IsOverdue);
        Assert.True(today.ShowRegularDueDate);
        Assert.Equal("", today.OverdueText);
        Assert.Equal("Due today", today.DueDateText);
    }

    [Fact]
    public async Task CompletedTask_IsNeverOverdue()
    {
        var task = await _service.AddAsync(Draft("late", due: Today.AddDays(-3)));
        await _service.SetCompletedAsync(task.Id, true);
        Assert.False(_vm.Tasks.Single().IsOverdue);
    }

    [Fact]
    public async Task SaveFailure_ShowsErrorMessage_InsteadOfThrowing()
    {
        await _service.AddAsync(Draft("A"));
        _store.FailSaves = true;

        var item = _vm.Tasks.Single();
        await item.ToggleCompletedCommand.ExecuteAsync(null);

        Assert.True(_vm.HasError);
        Assert.Contains("disk full", _vm.ErrorMessage);
        Assert.False(item.IsCompleted); // the change was undone, matching the file

        _vm.DismissErrorCommand.Execute(null);
        Assert.False(_vm.HasError);
    }

    [Fact]
    public async Task LoadCommand_ShowsWarningFromStore()
    {
        _store.LoadWarning = "file was corrupt";
        await _vm.LoadCommand.ExecuteAsync(null);

        Assert.True(_vm.HasWarning);
        Assert.False(_vm.IsLoading);
        Assert.True(_vm.ShowEmptyState);
    }

    [Fact]
    public async Task LoadCommand_Failure_ShowsError()
    {
        var store = new FakeTaskStore { FailLoad = true };
        var vm = new MainViewModel(new TaskService(store, _time), _navigation, _dialogs, _time);

        await vm.LoadCommand.ExecuteAsync(null);

        Assert.True(vm.HasError);
        Assert.False(vm.IsLoading);
    }

    [Fact]
    public async Task AddTask_IsDisabledWhileLoading()
    {
        var store = new SlowStore();
        var vm = new MainViewModel(new TaskService(store, _time), _navigation, _dialogs, _time);

        var loading = vm.LoadCommand.ExecuteAsync(null);
        Assert.True(vm.IsLoading);
        Assert.False(vm.AddTaskCommand.CanExecute(null));

        store.Finish();
        await loading;
        Assert.True(vm.AddTaskCommand.CanExecute(null));
    }

    [Fact]
    public async Task RefreshIfDayChanged_UpdatesDueTextAfterMidnight()
    {
        await _service.AddAsync(Draft("t", due: Today.AddDays(1)));
        var item = _vm.Tasks.Single();
        Assert.Equal("Due tomorrow", item.DueDateText);

        _time.Now = _time.Now.AddDays(1);
        _vm.RefreshIfDayChanged();

        Assert.Equal("Due today", item.DueDateText);
    }

    private sealed class SlowStore : ITaskStore
    {
        private readonly TaskCompletionSource<TaskLoadResult> _load = new();

        public void Finish() => _load.SetResult(new TaskLoadResult([]));

        public Task<TaskLoadResult> LoadAsync(CancellationToken cancellationToken = default) => _load.Task;

        public Task SaveAsync(IReadOnlyList<TaskFlow.Core.Models.TaskItem> tasks, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
