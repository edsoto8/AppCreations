using Avalonia;
using Avalonia.Controls;

namespace MetroSim.App.Views;

/// <summary>Chart plus label/value rows; used by the City, Traffic and Performance tabs.</summary>
public sealed partial class StatsPanel : UserControl
{
    public static readonly StyledProperty<string?> ChartTitleProperty =
        AvaloniaProperty.Register<StatsPanel, string?>(nameof(ChartTitle));

    public StatsPanel() => InitializeComponent();

    public string? ChartTitle
    {
        get => GetValue(ChartTitleProperty);
        set => SetValue(ChartTitleProperty, value);
    }
}
