using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;

namespace TaskFlow.Core.Services;

/// <summary>
/// The single source of truth for the user's tasks. Every view model reads from and writes through this class,
/// so the main list and the editor never disagree.
/// </summary>
public sealed class TaskService
{
    private readonly List<TaskItem> _tasks = [];
    private readonly TimeProvider _time;

    public TaskService(TimeProvider time)
    {
        _time = time;
    }

    /// <summary>Raised after any change to the task list, on the thread that made the change.</summary>
    public event EventHandler? Changed;

    public IReadOnlyList<TaskItem> Tasks => _tasks;

    public TaskItem? Find(Guid id) => _tasks.Find(t => t.Id == id);

    public Task<TaskItem> AddAsync(TaskDraft draft)
    {
        TaskValidator.EnsureValid(draft);
        draft = draft.Normalized();
        var task = new TaskItem
        {
            Title = draft.Title,
            Description = draft.Description,
            DueDate = draft.DueDate,
            Priority = draft.Priority,
            CreatedAt = _time.GetUtcNow(),
        };
        _tasks.Add(task);
        OnChanged();
        return Task.FromResult(task);
    }

    public Task UpdateAsync(Guid id, TaskDraft draft)
    {
        TaskValidator.EnsureValid(draft);
        draft = draft.Normalized();
        var task = Get(id);
        task.Title = draft.Title;
        task.Description = draft.Description;
        task.DueDate = draft.DueDate;
        task.Priority = draft.Priority;
        OnChanged();
        return Task.CompletedTask;
    }

    public Task SetCompletedAsync(Guid id, bool isCompleted)
    {
        var task = Get(id);
        if (task.IsCompleted != isCompleted)
        {
            task.IsCompleted = isCompleted;
            OnChanged();
        }

        return Task.CompletedTask;
    }

    public Task DeleteAsync(Guid id)
    {
        _tasks.Remove(Get(id));
        OnChanged();
        return Task.CompletedTask;
    }

    private TaskItem Get(Guid id) =>
        Find(id) ?? throw new KeyNotFoundException($"No task with id {id}.");

    private void OnChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
