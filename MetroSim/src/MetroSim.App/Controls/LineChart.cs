using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace MetroSim.App.Controls;

/// <summary>One line on a <see cref="LineChart"/>. <see cref="Values"/> are evenly spaced samples.</summary>
public sealed record ChartSeries(string Name, Color Colour, IReadOnlyList<double> Values, bool SecondaryAxis = false);

/// <summary>
/// A small multi-series line chart: shared x axis (samples), a left axis for primary series and an
/// optional right axis for secondary series, min/max labels, zero line and a legend.
/// </summary>
public sealed class LineChart : Control
{
    public static readonly StyledProperty<IReadOnlyList<ChartSeries>?> SeriesProperty =
        AvaloniaProperty.Register<LineChart, IReadOnlyList<ChartSeries>?>(nameof(Series));

    public static readonly StyledProperty<string?> TitleProperty =
        AvaloniaProperty.Register<LineChart, string?>(nameof(Title));

    /// <summary>Formats axis labels (e.g. money); defaults to grouped integers.</summary>
    public static readonly StyledProperty<Func<double, string>?> AxisFormatProperty =
        AvaloniaProperty.Register<LineChart, Func<double, string>?>(nameof(AxisFormat));

    public static readonly StyledProperty<Func<double, string>?> SecondaryFormatProperty =
        AvaloniaProperty.Register<LineChart, Func<double, string>?>(nameof(SecondaryFormat));

    private static readonly Typeface Face = new(FontFamily.Default);
    private static readonly IBrush TextBrush = new SolidColorBrush(Color.FromRgb(0x9A, 0xA6, 0xB4));
    private static readonly IPen GridPen = new Pen(new SolidColorBrush(Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF)), 1);
    private static readonly IPen ZeroPen = new Pen(new SolidColorBrush(Color.FromArgb(0x70, 0xFF, 0xFF, 0xFF)), 1, new DashStyle([4, 3], 0));

    static LineChart()
    {
        AffectsRender<LineChart>(SeriesProperty, TitleProperty);
    }

    public IReadOnlyList<ChartSeries>? Series
    {
        get => GetValue(SeriesProperty);
        set => SetValue(SeriesProperty, value);
    }

    public string? Title
    {
        get => GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    public Func<double, string>? AxisFormat
    {
        get => GetValue(AxisFormatProperty);
        set => SetValue(AxisFormatProperty, value);
    }

    public Func<double, string>? SecondaryFormat
    {
        get => GetValue(SecondaryFormatProperty);
        set => SetValue(SecondaryFormatProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);
        context.FillRectangle(new SolidColorBrush(Color.FromArgb(0x40, 0x00, 0x00, 0x00)), bounds, 6);
        var series = Series;
        double top = 8;
        if (!string.IsNullOrEmpty(Title))
        {
            var title = Text(Title, 12, Brushes.White);
            context.DrawText(title, new Point(10, 6));
            top = 8 + title.Height;
        }

        if (series is null || series.Count == 0 || series.All(s => s.Values.Count < 2))
        {
            var empty = Text("Collecting data…", 11, TextBrush);
            context.DrawText(empty, new Point((bounds.Width - empty.Width) / 2, (bounds.Height - empty.Height) / 2));
            return;
        }

        bool hasSecondary = series.Any(s => s.SecondaryAxis);
        var plot = new Rect(54, top + 4, Math.Max(10, bounds.Width - 54 - (hasSecondary ? 52 : 12)), Math.Max(10, bounds.Height - top - 30));
        var (min, max) = Range(series.Where(s => !s.SecondaryAxis));
        var (min2, max2) = Range(series.Where(s => s.SecondaryAxis));
        var format = AxisFormat ?? DefaultFormat;
        var format2 = SecondaryFormat ?? DefaultFormat;

        for (int i = 0; i <= 2; i++)
        {
            double y = plot.Top + plot.Height * i / 2;
            context.DrawLine(GridPen, new Point(plot.Left, y), new Point(plot.Right, y));
            var label = Text(format(max - (max - min) * i / 2), 10, TextBrush);
            context.DrawText(label, new Point(plot.Left - label.Width - 6, y - label.Height / 2));
            if (hasSecondary)
            {
                var label2 = Text(format2(max2 - (max2 - min2) * i / 2), 10, TextBrush);
                context.DrawText(label2, new Point(plot.Right + 6, y - label2.Height / 2));
            }
        }

        if (min < 0 && max > 0)
        {
            double zy = plot.Bottom - (0 - min) / (max - min) * plot.Height;
            context.DrawLine(ZeroPen, new Point(plot.Left, zy), new Point(plot.Right, zy));
        }

        foreach (var s in series)
        {
            if (s.Values.Count < 2)
            {
                continue;
            }

            double lo = s.SecondaryAxis ? min2 : min;
            double hi = s.SecondaryAxis ? max2 : max;
            var geometry = new StreamGeometry();
            using (var g = geometry.Open())
            {
                for (int i = 0; i < s.Values.Count; i++)
                {
                    var p = new Point(
                        plot.Left + plot.Width * i / (s.Values.Count - 1),
                        plot.Bottom - (s.Values[i] - lo) / (hi - lo) * plot.Height);
                    if (i == 0)
                    {
                        g.BeginFigure(p, false);
                    }
                    else
                    {
                        g.LineTo(p);
                    }
                }

                g.EndFigure(false);
            }

            context.DrawGeometry(null, new Pen(new SolidColorBrush(s.Colour), 2, lineJoin: PenLineJoin.Round), geometry);
        }

        // Legend along the bottom.
        double lx = plot.Left;
        double ly = plot.Bottom + 8;
        foreach (var s in series)
        {
            context.FillRectangle(new SolidColorBrush(s.Colour), new Rect(lx, ly + 4, 10, 4), 2);
            var name = Text(s.Name + (s.SecondaryAxis ? " (right)" : ""), 10, TextBrush);
            context.DrawText(name, new Point(lx + 14, ly - 1));
            lx += 14 + name.Width + 14;
        }
    }

    private static (double Min, double Max) Range(IEnumerable<ChartSeries> series)
    {
        double min = double.MaxValue;
        double max = double.MinValue;
        foreach (var s in series)
        {
            foreach (double v in s.Values)
            {
                min = Math.Min(min, v);
                max = Math.Max(max, v);
            }
        }

        if (min == double.MaxValue)
        {
            return (0, 1);
        }

        // Charts of positive quantities start at zero so growth reads honestly.
        if (min > 0)
        {
            min = 0;
        }

        if (max - min < 1e-9)
        {
            max = min + 1;
        }

        return (min, max + (max - min) * 0.05);
    }

    private static string DefaultFormat(double v) => Math.Abs(v) >= 10_000
        ? (v / 1000).ToString("N0", CultureInfo.InvariantCulture) + "k"
        : Math.Abs(v) >= 10 ? v.ToString("N0", CultureInfo.InvariantCulture) : v.ToString("0.##", CultureInfo.InvariantCulture);

    private static FormattedText Text(string text, double size, IBrush brush) =>
        new(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, Face, size, brush);
}
