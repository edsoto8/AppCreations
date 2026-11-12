using Windows.UI.Text;

namespace TaskFlow;

/// <summary>
/// Small helper functions for x:Bind. x:Bind can call static methods directly, for example
/// <c>Opacity="{x:Bind local:Ui.DimIf(IsCompleted), Mode=OneWay}"</c>, which replaces most value converters.
/// </summary>
public static class Ui
{
    public static TextDecorations StrikeIf(bool value) => value ? TextDecorations.Strikethrough : TextDecorations.None;

    public static double DimIf(bool value) => value ? 0.6 : 1.0;

    public static Visibility VisibleIfNot(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static Visibility VisibleIfAny(bool a, bool b) => a || b ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>Accessible names such as "Edit Buy milk", so screen readers say which task a button affects.</summary>
    public static string Label(string action, string title) => $"{action} {title}";
}
