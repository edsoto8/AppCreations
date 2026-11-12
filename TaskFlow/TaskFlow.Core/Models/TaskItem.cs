namespace TaskFlow.Core.Models;

/// <summary>
/// One task, exactly as it is stored on disk. This is the "Model" in MVVM: plain data with no UI code and no
/// change notification. The UI works with <c>TaskItemViewModel</c>, which wraps one of these.
/// </summary>
public sealed class TaskItem
{
    public Guid Id { get; init; } = Guid.NewGuid();

    public required string Title { get; set; }

    public string Description { get; set; } = string.Empty;

    /// <summary>Optional due date. <see cref="DateOnly"/> because a due date has no time of day.</summary>
    public DateOnly? DueDate { get; set; }

    public Priority Priority { get; set; } = Priority.Medium;

    public bool IsCompleted { get; set; }

    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
}
