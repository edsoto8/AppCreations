using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;

namespace MetroSim.App.Controls;

/// <summary>Vertical RCI demand bar: grows up from the middle for positive demand, down for negative.</summary>
public sealed class DemandMeter : Control
{
    public static readonly StyledProperty<int> ValueProperty =
        AvaloniaProperty.Register<DemandMeter, int>(nameof(Value));

    public static readonly StyledProperty<IBrush?> FillProperty =
        AvaloniaProperty.Register<DemandMeter, IBrush?>(nameof(Fill), Brushes.Gray);

    private static readonly IBrush Track = new SolidColorBrush(Color.FromArgb(0x50, 0x00, 0x00, 0x00));
    private static readonly IPen Mid = new Pen(new SolidColorBrush(Color.FromArgb(0x90, 0xFF, 0xFF, 0xFF)), 1);

    static DemandMeter()
    {
        AffectsRender<DemandMeter>(ValueProperty, FillProperty);
    }

    /// <summary>Demand, -100..100.</summary>
    public int Value
    {
        get => GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    public IBrush? Fill
    {
        get => GetValue(FillProperty);
        set => SetValue(FillProperty, value);
    }

    public override void Render(DrawingContext context)
    {
        var b = new Rect(Bounds.Size);
        context.FillRectangle(Track, b, 2);
        double mid = b.Height / 2;
        double h = Math.Clamp(Value, -100, 100) / 100.0 * mid;
        var bar = h >= 0 ? new Rect(0, mid - h, b.Width, h) : new Rect(0, mid, b.Width, -h);
        context.FillRectangle(Fill ?? Brushes.Gray, bar, 2);
        context.DrawLine(Mid, new Point(0, mid), new Point(b.Width, mid));
    }
}
