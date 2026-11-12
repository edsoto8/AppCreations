using TaskFlow.Core.Models;
using TaskFlow.Core.Services;

namespace TaskFlow.Tests;

/// <summary>A clock that always says the same time, so date-dependent tests never flake.</summary>
public sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public static readonly DateTimeOffset DefaultNow = new(2026, 3, 10, 9, 0, 0, TimeSpan.Zero);

    public FixedTimeProvider() : this(DefaultNow) { }

    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;

    public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
}

public static class TestData
{
    public static readonly DateOnly Today = DateOnly.FromDateTime(FixedTimeProvider.DefaultNow.UtcDateTime);

    public static TaskDraft Draft(string title = "Task", Priority priority = Priority.Medium, DateOnly? due = null, string description = "") =>
        new(title, description, due, priority);

    public static TaskItem Item(string title, Priority priority = Priority.Medium, DateOnly? due = null, bool completed = false, int createdMinute = 0) =>
        new()
        {
            Title = title,
            Priority = priority,
            DueDate = due,
            IsCompleted = completed,
            CreatedAt = FixedTimeProvider.DefaultNow.AddMinutes(createdMinute),
        };
}

/// <summary>Records navigation requests instead of navigating.</summary>
public sealed class FakeNavigation : INavigationService
{
    public List<Guid?> OpenedEditors { get; } = [];

    public int BackCount { get; private set; }

    public void OpenTaskEditor(Guid? taskId) => OpenedEditors.Add(taskId);

    public void GoBack() => BackCount++;
}

/// <summary>Answers every confirmation with <see cref="Answer"/>.</summary>
public sealed class FakeDialogs : IDialogService
{
    public bool Answer { get; set; } = true;

    public int AskCount { get; private set; }

    public Task<bool> ConfirmAsync(string title, string message, string confirmText)
    {
        AskCount++;
        return Task.FromResult(Answer);
    }
}

/// <summary>An in-memory <see cref="ITaskStore"/>. Set <see cref="FailSaves"/> or <see cref="FailLoad"/> to simulate disk errors.</summary>
public sealed class FakeTaskStore : ITaskStore
{
    public List<TaskItem> Saved { get; set; } = [];

    public int SaveCount { get; private set; }

    public bool FailSaves { get; set; }

    public bool FailLoad { get; set; }

    public string? LoadWarning { get; set; }

    public Task<TaskLoadResult> LoadAsync(CancellationToken cancellationToken = default) =>
        FailLoad
            ? throw new TaskStoreException("disk unreadable")
            : Task.FromResult(new TaskLoadResult(Saved.ToList(), LoadWarning));

    public Task SaveAsync(IReadOnlyList<TaskItem> tasks, CancellationToken cancellationToken = default)
    {
        if (FailSaves)
        {
            throw new TaskStoreException("disk full");
        }

        SaveCount++;
        Saved = tasks.ToList();
        return Task.CompletedTask;
    }
}

public static class Services
{
    /// <summary>A TaskService over a fake store that has already "loaded" (so saving is allowed).</summary>
    public static TaskService LoadedTaskService(FakeTaskStore? store = null, TimeProvider? time = null)
    {
        var service = new TaskService(store ?? new FakeTaskStore(), time ?? new FixedTimeProvider());
        service.LoadAsync().GetAwaiter().GetResult();
        return service;
    }
}

/// <summary>A unique temporary folder per test, deleted afterwards.</summary>
public sealed class TempFolder : IDisposable
{
    public TempFolder()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "taskflow-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try { Directory.Delete(Path, recursive: true); } catch (IOException) { }
    }
}
