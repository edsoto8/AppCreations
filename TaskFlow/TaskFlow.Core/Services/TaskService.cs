using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;

namespace TaskFlow.Core.Services;

/// <summary>
/// The single source of truth for the user's tasks. Every view model reads from and writes through this class,
/// so the main list and the editor never disagree. Every change is saved through <see cref="ITaskStore"/>.
/// </summary>
public sealed class TaskService
{
    private readonly List<TaskItem> _tasks = [];
    private readonly ITaskStore _store;
    private readonly TimeProvider _time;
    private readonly ILogger<TaskService> _logger;

    // Only one save at a time, so two quick changes can't write the file at the same moment.
    private readonly SemaphoreSlim _saveLock = new(1, 1);

    // False until a load succeeds. Saving before then could overwrite tasks we failed to read.
    private bool _canSave;

    public TaskService(ITaskStore store, TimeProvider time, ILogger<TaskService>? logger = null)
    {
        _store = store;
        _time = time;
        _logger = logger ?? NullLogger<TaskService>.Instance;
    }

    /// <summary>Raised after any change to the task list, on the thread that made the change.</summary>
    public event EventHandler? Changed;

    public IReadOnlyList<TaskItem> Tasks => _tasks;

    public TaskItem? Find(Guid id) => _tasks.Find(t => t.Id == id);

    /// <summary>
    /// Loads saved tasks, replacing whatever is in memory. Returns a warning for the user, or null.
    /// Throws <see cref="TaskStoreException"/> when the file can't be read; saving stays disabled in that case.
    /// </summary>
    public async Task<string?> LoadAsync(CancellationToken cancellationToken = default)
    {
        var result = await _store.LoadAsync(cancellationToken);
        _tasks.Clear();
        _tasks.AddRange(result.Tasks);
        _canSave = true;
        OnChanged();
        return result.Warning;
    }

    public async Task<TaskItem> AddAsync(TaskDraft draft)
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
        await CommitAsync();
        return task;
    }

    public async Task UpdateAsync(Guid id, TaskDraft draft)
    {
        TaskValidator.EnsureValid(draft);
        draft = draft.Normalized();
        var task = Get(id);
        task.Title = draft.Title;
        task.Description = draft.Description;
        task.DueDate = draft.DueDate;
        task.Priority = draft.Priority;
        await CommitAsync();
    }

    public async Task SetCompletedAsync(Guid id, bool isCompleted)
    {
        var task = Get(id);
        if (task.IsCompleted != isCompleted)
        {
            task.IsCompleted = isCompleted;
            await CommitAsync();
        }
    }

    public async Task DeleteAsync(Guid id)
    {
        _tasks.Remove(Get(id));
        await CommitAsync();
    }

    private TaskItem Get(Guid id) =>
        Find(id) ?? throw new KeyNotFoundException($"No task with id {id}.");

    /// <summary>Tells listeners about the change, then saves. A save failure surfaces as <see cref="TaskStoreException"/>.</summary>
    private async Task CommitAsync()
    {
        // Update the UI first: the change has happened in memory even if saving fails.
        OnChanged();

        if (!_canSave)
        {
            throw new TaskStoreException("Changes can't be saved because your saved tasks couldn't be loaded.");
        }

        var snapshot = _tasks.ToList(); // copy, so later changes don't affect this save
        await _saveLock.WaitAsync();
        try
        {
            await _store.SaveAsync(snapshot);
        }
        finally
        {
            _saveLock.Release();
        }

        _logger.LogDebug("Saved {Count} tasks", snapshot.Count);
    }

    private void OnChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
