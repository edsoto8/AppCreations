namespace BoardFlow.Core.Domain;

public sealed class Board
{
    public long Id { get; set; }
    public long WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public int SortOrder { get; set; }
}
