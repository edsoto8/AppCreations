using System.Globalization;
using Avalonia.Data.Converters;
using Avalonia.Media;
using BoardFlow.Core.Domain;

namespace BoardFlow.App.Converters;

/// <summary>"#RRGGBB" → brush, for label colours.</summary>
public sealed class HexToBrushConverter : IValueConverter
{
    public static HexToBrushConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string hex && Color.TryParse(hex, out var color) ? new SolidColorBrush(color) : Brushes.Gray;

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Priority → badge colour. Higher priorities are warmer.</summary>
public sealed class PriorityToBrushConverter : IValueConverter
{
    private static readonly IReadOnlyDictionary<Priority, IBrush> Brushes = new Dictionary<Priority, IBrush>
    {
        [Priority.None] = new SolidColorBrush(Color.Parse("#8A94A3")),
        [Priority.Low] = new SolidColorBrush(Color.Parse("#5B7FA6")),
        [Priority.Medium] = new SolidColorBrush(Color.Parse("#B7791F")),
        [Priority.High] = new SolidColorBrush(Color.Parse("#D9622B")),
        [Priority.Critical] = new SolidColorBrush(Color.Parse("#C93C3C")),
    };

    public static PriorityToBrushConverter Instance { get; } = new();

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is Priority priority && Brushes.TryGetValue(priority, out var brush) ? brush : Brushes[Priority.None];

    public object? ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}
