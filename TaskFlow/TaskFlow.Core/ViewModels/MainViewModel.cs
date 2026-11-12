using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;
using TaskFlow.Core.Services;

namespace TaskFlow.Core.ViewModels;

/// <summary>
/// The view model behind MainPage: the visible task list, the filter and sort choices, the counters and the
/// page-level commands. It never touches a XAML control; the page binds to it instead.
/// </summary>
public sealed partial class MainViewModel : ObservableObject
{
    private readonly TaskService _tasks;
    private readonly TimeProvider _time;

    // One item view model per task, reused across refreshes so the ListView keeps its rows.
    private readonly Dictionary<Guid, TaskItemViewModel> _itemCache = [];

    public MainViewModel(TaskService tasks, TimeProvider time)
    {
        _tasks = tasks;
        _time = time;

        SelectedFilter = FilterChoices[0];
        SelectedSort = SortChoices[0];

        // Whenever the data changes (here or in another view model), rebuild what the page shows.
        _tasks.Changed += (_, _) => Refresh();
        Refresh();
    }

    /// <summary>The tasks the list shows, already filtered and sorted. The ListView binds to this.</summary>
    public ObservableCollection<TaskItemViewModel> Tasks { get; } = [];

    public IReadOnlyList<Choice<TaskFilter>> FilterChoices { get; } =
    [
        new(TaskFilter.All, "All"),
        new(TaskFilter.Active, "Active"),
        new(TaskFilter.Completed, "Completed"),
    ];

    public IReadOnlyList<Choice<TaskSortOrder>> SortChoices { get; } =
    [
        new(TaskSortOrder.DueDate, "Due date"),
        new(TaskSortOrder.Priority, "Priority"),
    ];

    // [ObservableProperty] on a partial property makes the source generator write the property body,
    // including the PropertyChanged notification. It also calls the On...Changed partial methods below.
    [ObservableProperty]
    public partial Choice<TaskFilter> SelectedFilter { get; set; }

    [ObservableProperty]
    public partial Choice<TaskSortOrder> SelectedSort { get; set; }

    [ObservableProperty]
    public partial int TotalCount { get; private set; }

    [ObservableProperty]
    public partial int CompletedCount { get; private set; }

    /// <summary>A user-facing error (for example "couldn't save"), or null when there is nothing to show.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    public partial string? ErrorMessage { get; set; }

    public bool HasError => ErrorMessage is not null;

    public string SummaryText => TotalCount == 0
        ? "No tasks yet"
        : $"{CompletedCount} of {TotalCount} completed";

    public bool IsEmpty => Tasks.Count == 0;

    public string EmptyTitle => TotalCount == 0 ? "No tasks yet" : $"No {SelectedFilter.Label.ToLowerInvariant()} tasks";

    public string EmptyMessage => TotalCount == 0
        ? "Add your first task to get started."
        : "Try a different filter to see your other tasks.";

    /// <summary>Today's date in the user's time zone. Used for "Due today" and overdue checks.</summary>
    public DateOnly Today => DateOnly.FromDateTime(_time.GetLocalNow().DateTime);

    [RelayCommand]
    private async Task AddTaskAsync()
    {
        // Milestone 3: add a placeholder task directly. Milestone 4 replaces this with the editor page.
        await RunAsync(() => _tasks.AddAsync(new TaskDraft($"New task {TotalCount + 1}", "", null, Priority.Medium)));
    }

    [RelayCommand]
    private void DismissError() => ErrorMessage = null;

    internal Task SetCompletedAsync(TaskItemViewModel item, bool isCompleted) =>
        RunAsync(() => _tasks.SetCompletedAsync(item.Id, isCompleted));

    internal void EditTask(TaskItemViewModel item)
    {
        // Implemented in Milestone 4.
    }

    internal Task DeleteTaskAsync(TaskItemViewModel item) =>
        RunAsync(() => _tasks.DeleteAsync(item.Id));

    partial void OnSelectedFilterChanged(Choice<TaskFilter> value) => Refresh();

    partial void OnSelectedSortChanged(Choice<TaskSortOrder> value) => Refresh();

    /// <summary>Re-applies filter and sort to the current data and updates every derived value.</summary>
    private void Refresh()
    {
        // The constructor sets the filter before the sort, so the first call can arrive with no sort yet.
        if (SelectedFilter is null || SelectedSort is null)
        {
            return;
        }

        var all = _tasks.Tasks;
        TotalCount = all.Count;
        CompletedCount = all.Count(t => t.IsCompleted);

        // Drop cached view models for deleted tasks, create them for new ones.
        foreach (var id in _itemCache.Keys.Where(id => _tasks.Find(id) is null).ToList())
        {
            _itemCache.Remove(id);
        }

        var visible = TaskQuery.Apply(all, SelectedFilter.Value, SelectedSort.Value)
            .Select(GetOrCreateItem)
            .ToList();

        Tasks.SyncTo(visible);
        foreach (var item in visible)
        {
            item.Refresh();
        }

        OnPropertyChanged(nameof(SummaryText));
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(EmptyTitle));
        OnPropertyChanged(nameof(EmptyMessage));
    }

    private TaskItemViewModel GetOrCreateItem(TaskItem task)
    {
        if (!_itemCache.TryGetValue(task.Id, out var item))
        {
            item = new TaskItemViewModel(task, this);
            _itemCache[task.Id] = item;
        }

        return item;
    }

    /// <summary>
    /// The error boundary for every user action: if something fails, show a message instead of crashing.
    /// </summary>
    private async Task RunAsync(Func<Task> action)
    {
        try
        {
            ErrorMessage = null;
            await action();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            ErrorMessage = ex.Message;
        }
    }
}
