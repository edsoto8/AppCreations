namespace BoardFlow.Core.Domain;

/// <summary>The user-editable fields of a card, used for both create and update.</summary>
public sealed record CardInput(
    string Title,
    string? Description = null,
    Priority Priority = Priority.None,
    DateOnly? DueDate = null,
    IReadOnlyCollection<long>? LabelIds = null);
