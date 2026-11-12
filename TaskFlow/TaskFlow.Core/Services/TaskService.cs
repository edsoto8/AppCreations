using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;

namespace TaskFlow.Core.Services;

/// <summary>
/// The single source of truth for the user's tasks. Every view model reads from and writes through this class,
/// so the main list and the editor never disagree.
/// <para>
/// Every change is saved through <see cref="ITaskStore"/> straight away. If saving fails, the change is undone,
/// so what the app shows always matches what is on disk.
/// </para>
/// </summary>
public sealed class TaskService
{
    private readonly List<TaskItem> _tasks = [];
    private readonly ITaskStore _store;
    private readonly TimeProvider _time;
    private readonly ILogger<TaskService> _logger;

    // Only one save at a time, so two quick changes can't write the file at the same moment.
    private readonly SemaphoreSlim _saveLock = new(1, 1);

    // Null until a load succeeds; otherwise the reason saving is not allowed.
    // Saving before a successful load could overwrite tasks we failed to read.
    private string? _cannotSaveReason = "Your tasks haven't finished loading yet.";

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
        TaskLoadResult result;
        try
        {
            result = await _store.LoadAsync(cancellationToken);
        }
        catch (TaskStoreException)
        {
            _cannotSaveReason = "Changes can't be saved because your saved tasks couldn't be loaded.";
            throw;
        }

        _tasks.Clear();
        _tasks.AddRange(result.Tasks);
        _cannotSaveReason = result.IsReadOnly ? "These tasks are read-only, so changes can't be saved." : null;
        OnChanged();
        return result.Warning;
    }

    public async Task<TaskItem> AddAsync(TaskDraft draft)
    {
        TaskValidator.EnsureValid(draft);
        EnsureCanSave();
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
        await CommitAsync(undo: () => _tasks.Remove(task));
        return task;
    }

    public async Task UpdateAsync(Guid id, TaskDraft draft)
    {
        TaskValidator.EnsureValid(draft);
        EnsureCanSave();
        draft = draft.Normalized();
        var task = Get(id);
        var before = task.Clone();
        task.Title = draft.Title;
        task.Description = draft.Description;
        task.DueDate = draft.DueDate;
        task.Priority = draft.Priority;
        await CommitAsync(undo: () =>
        {
            task.Title = before.Title;
            task.Description = before.Description;
            task.DueDate = before.DueDate;
            task.Priority = before.Priority;
        });
    }

    public async Task SetCompletedAsync(Guid id, bool isCompleted)
    {
        EnsureCanSave();
        var task = Get(id);
        if (task.IsCompleted != isCompleted)
        {
            task.IsCompleted = isCompleted;
            await CommitAsync(undo: () => task.IsCompleted = !isCompleted);
        }
    }

    public async Task DeleteAsync(Guid id)
    {
        EnsureCanSave();
        var task = Get(id);
        var index = _tasks.IndexOf(task);
        _tasks.RemoveAt(index);
        await CommitAsync(undo: () => _tasks.Insert(index, task));
    }

    private TaskItem Get(Guid id) =>
        Find(id) ?? throw new KeyNotFoundException($"No task with id {id}.");

    private void EnsureCanSave()
    {
        if (_cannotSaveReason is not null)
        {
            throw new TaskStoreException(_cannotSaveReason);
        }
    }

    /// <summary>
    /// Shows the change, then saves it. If saving fails, runs <paramref name="undo"/> so memory matches the file
    /// again, and rethrows the <see cref="TaskStoreException"/> for the view model to display.
    /// </summary>
    private async Task CommitAsync(Action undo)
    {
        // Update the UI first so the app feels instant.
        OnChanged();

        // Copy every task, so edits made while the file is being written can't end up half-saved.
        var snapshot = _tasks.Select(t => t.Clone()).ToList();
        await _saveLock.WaitAsync();
        try
        {
            await _store.SaveAsync(snapshot);
        }
        catch (TaskStoreException)
        {
            undo();
            OnChanged();
            throw;
        }
        finally
        {
            _saveLock.Release();
        }

        _logger.LogDebug("Saved {Count} tasks", snapshot.Count);
    }

    private void OnChanged() => Changed?.Invoke(this, EventArgs.Empty);
}
