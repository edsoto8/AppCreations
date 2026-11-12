namespace TaskFlow.Core.Models;

/// <summary>
/// The values a user typed into the task form, before they are turned into (or applied to) a <see cref="TaskItem"/>.
/// A record gives us value equality and an easy <c>with</c> expression for tests.
/// </summary>
public sealed record TaskDraft(string Title, string Description, DateOnly? DueDate, Priority Priority)
{
    /// <summary>A copy with surrounding whitespace removed, which is what we validate and store.</summary>
    public TaskDraft Normalized() => this with
    {
        Title = (Title ?? string.Empty).Trim(),
        Description = (Description ?? string.Empty).Trim(),
    };
}
