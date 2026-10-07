namespace BoardFlow.App.ViewModels;

internal static class Text
{
    /// <summary>"1 card", "3 cards".</summary>
    public static string Plural(int count, string noun) => count == 1 ? $"1 {noun}" : $"{count} {noun}s";
}
