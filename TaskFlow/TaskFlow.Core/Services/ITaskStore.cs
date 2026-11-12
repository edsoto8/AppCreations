using TaskFlow.Core.Models;

namespace TaskFlow.Core.Services;

/// <summary>Where tasks are saved. The app uses <see cref="JsonTaskStore"/>; tests can use an in-memory fake.</summary>
public interface ITaskStore
{
    /// <summary>
    /// Loads all tasks. A missing file gives an empty list. A file that can't be understood gives an empty list
    /// plus a <see cref="TaskLoadResult.Warning"/>. Throws <see cref="TaskStoreException"/> only when the file
    /// exists but can't be read at all (for example, no permission).
    /// </summary>
    Task<TaskLoadResult> LoadAsync(CancellationToken cancellationToken = default);

    /// <summary>Replaces the saved tasks. Throws <see cref="TaskStoreException"/> when saving fails.</summary>
    Task SaveAsync(IReadOnlyList<TaskItem> tasks, CancellationToken cancellationToken = default);
}

/// <summary>What <see cref="ITaskStore.LoadAsync"/> found, and an optional message to show the user.</summary>
public sealed record TaskLoadResult(IReadOnlyList<TaskItem> Tasks, string? Warning = null);

/// <summary>A storage problem, with a message that is safe to show to the user.</summary>
public sealed class TaskStoreException(string message, Exception? innerException = null)
    : Exception(message, innerException);
