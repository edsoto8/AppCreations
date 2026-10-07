namespace BoardFlow.Core.Rules;

public static class DefaultColumns
{
    /// <summary>The columns offered for a new board, in order.</summary>
    public static IReadOnlyList<string> Names { get; } = ["Backlog", "Todo", "In Progress", "Review", "Done"];
}
