using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels;

/// <summary>A card tile on the board. Instances are reused across reloads (keyed by card id).</summary>
public sealed partial class CardItemViewModel : ObservableObject
{
    public CardItemViewModel(Card card, IReadOnlyDictionary<long, LabelChip> labels, DateOnly today)
    {
        Id = card.Id;
        Update(card, labels, today);
    }

    public long Id { get; }

    public Card Card { get; private set; } = null!;

    [ObservableProperty]
    public partial long ColumnId { get; private set; }

    [ObservableProperty]
    public partial string Title { get; private set; } = "";

    [ObservableProperty]
    public partial bool HasDescription { get; private set; }

    [ObservableProperty]
    public partial Priority Priority { get; private set; }

    [ObservableProperty]
    public partial string? DueText { get; private set; }

    [ObservableProperty]
    public partial DueState DueState { get; private set; }

    [ObservableProperty]
    public partial IReadOnlyList<LabelChip> Labels { get; private set; } = [];

    public bool HasPriority => Priority != Priority.None;

    public bool HasDueDate => DueState != DueState.None;

    public bool HasLabels => Labels.Count > 0;

    public bool IsOverdue => DueState == DueState.Overdue;

    public bool IsDueToday => DueState == DueState.DueToday;

    public bool HasFooter => HasPriority || HasDueDate || HasDescription;

    public string PriorityText => Priority.ToString();

    /// <summary>Spoken name for screen readers, summarising what the tile shows.</summary>
    public string AccessibleName => string.Join(", ", new[]
    {
        Title,
        HasPriority ? $"{Priority} priority" : null,
        DueText is null ? null : $"due {DueText}",
        DueState == DueState.Overdue ? "overdue" : null,
        HasLabels ? "labels " + string.Join(" ", Labels.Select(l => l.Name)) : null,
    }.Where(part => part is not null));

    public void Update(Card card, IReadOnlyDictionary<long, LabelChip> labels, DateOnly today)
    {
        Card = card;
        ColumnId = card.ColumnId;
        Title = card.Title;
        HasDescription = card.Description.Length > 0;
        Priority = card.Priority;
        DueState = DueDates.GetState(card.DueDate, today);
        DueText = card.DueDate is { } due ? FormatDue(due, today) : null;
        Labels = card.LabelIds.Where(labels.ContainsKey).Select(id => labels[id]).ToList();
        OnPropertyChanged(nameof(HasPriority));
        OnPropertyChanged(nameof(HasDueDate));
        OnPropertyChanged(nameof(HasLabels));
        OnPropertyChanged(nameof(IsOverdue));
        OnPropertyChanged(nameof(IsDueToday));
        OnPropertyChanged(nameof(HasFooter));
        OnPropertyChanged(nameof(PriorityText));
        OnPropertyChanged(nameof(AccessibleName));
    }

    private static string FormatDue(DateOnly due, DateOnly today) => due.Year == today.Year
        ? due.ToString("MMM d", System.Globalization.CultureInfo.CurrentCulture)
        : due.ToString("MMM d, yyyy", System.Globalization.CultureInfo.CurrentCulture);
}
