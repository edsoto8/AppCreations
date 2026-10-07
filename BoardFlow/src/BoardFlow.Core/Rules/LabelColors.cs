namespace BoardFlow.Core.Rules;

public static class LabelColors
{
    /// <summary>A palette of readable label colours offered by the UI. Any #RRGGBB value is valid.</summary>
    public static IReadOnlyList<string> Palette { get; } =
    [
        "#E5534B", "#E8833A", "#D4A72C", "#4CAF6A", "#2DA197",
        "#3A7BD5", "#7A5CDB", "#C2549C", "#6E7781", "#8B5A2B",
    ];
}
