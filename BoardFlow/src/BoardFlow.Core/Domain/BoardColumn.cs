namespace BoardFlow.Core.Domain;

/// <summary>A column (list) on a board. Named <c>BoardColumn</c> to avoid clashing with UI grid columns.</summary>
public sealed class BoardColumn
{
    public long Id { get; set; }
    public long BoardId { get; set; }
    public string Name { get; set; } = "";
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
