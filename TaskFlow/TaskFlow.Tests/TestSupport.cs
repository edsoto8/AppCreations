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
