using TaskFlow.Core.Models;

namespace TaskFlow.Core.Logic;

/// <summary>The result of validating a <see cref="TaskDraft"/>: one message per invalid field, null when the field is fine.</summary>
public sealed record TaskValidationResult(string? TitleError, string? DescriptionError)
{
    public bool IsValid => TitleError is null && DescriptionError is null;
}

/// <summary>Every input rule for a task, in one place. The editor uses it for feedback; TaskService uses it as a guard.</summary>
public static class TaskValidator
{
    public const int MaxTitleLength = 100;
    public const int MaxDescriptionLength = 1000;

    public static TaskValidationResult Validate(TaskDraft draft)
    {
        draft = draft.Normalized();

        string? titleError = draft.Title.Length switch
        {
            0 => "Give the task a title.",
            > MaxTitleLength => $"Keep the title to {MaxTitleLength} characters or fewer.",
            _ => null,
        };

        string? descriptionError = draft.Description.Length > MaxDescriptionLength
            ? $"Keep the description to {MaxDescriptionLength} characters or fewer."
            : null;

        return new TaskValidationResult(titleError, descriptionError);
    }

    /// <summary>Throws when the draft is invalid. Used by code that must never store bad data.</summary>
    public static void EnsureValid(TaskDraft draft)
    {
        var result = Validate(draft);
        if (!result.IsValid)
        {
            throw new ArgumentException(result.TitleError ?? result.DescriptionError, nameof(draft));
        }
    }
}
