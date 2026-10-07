namespace BoardFlow.Core.Domain;

public sealed class Workspace
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
