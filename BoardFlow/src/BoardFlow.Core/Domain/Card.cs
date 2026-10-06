namespace BoardFlow.Core.Domain;

public sealed class Card
{
    public long Id { get; set; }
    public long ColumnId { get; set; }
    public string Title { get; set; } = "";

    /// <summary>Plain-text description. May be empty, never null.</summary>
    public string Description { get; set; } = "";

    public Priority Priority { get; set; }
    public DateOnly? DueDate { get; set; }
    public bool IsArchived { get; set; }

    /// <summary>Position among the non-archived cards of its column (0-based, dense).</summary>
    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }

    /// <summary>Ids of the labels attached to this card, ascending.</summary>
    public List<long> LabelIds { get; set; } = [];
}
