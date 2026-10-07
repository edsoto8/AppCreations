namespace BoardFlow.Core.Domain;

/// <summary>A workspace-wide label. <see cref="DisplayColor"/> is a <c>#RRGGBB</c> hex string.</summary>
public sealed class Label
{
    public long Id { get; set; }
    public long WorkspaceId { get; set; }
    public string Name { get; set; } = "";
    public string DisplayColor { get; set; } = "";
}
