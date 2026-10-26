using Avalonia.Media;
using MetroSim.App.Rendering;
using MetroSim.App.Tools;
using MetroSim.Core.Engine;

namespace MetroSim.App.ViewModels;

/// <summary>A label/value row in a dashboard or the inspector.</summary>
public sealed record StatLine(string Label, string Value, bool Warning = false);

/// <summary>A budget ledger row.</summary>
public sealed record LedgerRow(string Label, string Amount, bool Income);

/// <summary>An event log entry; <see cref="Tile"/> is -1 when the event is not tied to a place.</summary>
public sealed record EventItem(string Time, string Message, EventSeverity Severity, int Tile)
{
    public bool HasLocation => Tile >= 0;

    public IBrush SeverityBrush => Severity switch
    {
        EventSeverity.Critical => new SolidColorBrush(Color.FromRgb(0xF0, 0x50, 0x48)),
        EventSeverity.Warning => new SolidColorBrush(Color.FromRgb(0xF0, 0xB8, 0x40)),
        _ => new SolidColorBrush(Color.FromRgb(0x6C, 0xB0, 0xF0)),
    };
}

/// <summary>Overlay legend swatch.</summary>
public sealed record LegendItem(IBrush Swatch, string Label)
{
    public static LegendItem From(LegendEntry e) =>
        new(new SolidColorBrush(Color.FromArgb(e.Colour.Alpha, e.Colour.Red, e.Colour.Green, e.Colour.Blue)), e.Label);
}

/// <summary>Toolbar button state for a tool.</summary>
public sealed class ToolItemViewModel(ToolDefinition definition) : CommunityToolkit.Mvvm.ComponentModel.ObservableObject
{
    private bool _isActive;

    public ToolDefinition Definition { get; } = definition;

    public string Name => Definition.Name;

    public string Shortcut => Definition.ShortcutLabel;

    public string Tooltip => $"{Definition.Name} ({Definition.ShortcutLabel})\n{Definition.Description}";

    public ToolKind Kind => Definition.Kind;

    public bool IsActive
    {
        get => _isActive;
        set => SetProperty(ref _isActive, value);
    }
}

public sealed record ToolGroup(string Name, IReadOnlyList<ToolItemViewModel> Tools);

/// <summary>A speed button.</summary>
public sealed class SpeedOption(string label, SimulationSpeed speed, string tooltip) : CommunityToolkit.Mvvm.ComponentModel.ObservableObject
{
    private bool _isActive;

    public string Label { get; } = label;

    public SimulationSpeed Speed { get; } = speed;

    public string Tooltip { get; } = tooltip;

    public bool IsActive
    {
        get => _isActive;
        set => SetProperty(ref _isActive, value);
    }
}
