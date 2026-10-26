using Avalonia;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using MetroSim.App.Tests.Support;
using MetroSim.App.Tools;
using MetroSim.Core.World;

namespace MetroSim.App.Tests.Ui;

/// <summary>Pan, zoom and tool-cancel input on the map view.</summary>
public sealed class CameraAndInputTests
{
    [AvaloniaFact]
    public void WheelZoom_KeepsTheTileUnderTheCursorFixed()
    {
        using var s = new TestSession();
        s.Show();
        s.Map.Camera.CenterOn(64, 64);
        s.Map.Camera.Zoom = 10;
        s.Frame();
        var local = new Point(200, 150);
        var before = s.Map.Camera.ScreenToWorld(local.X, local.Y);
        var point = s.Map.TranslatePoint(local, s.Window)!.Value;
        s.Window.MouseMove(point, RawInputModifiers.None);
        s.Window.MouseWheel(point, new Vector(0, 3), RawInputModifiers.None);
        TestSession.Pump();
        Assert.Equal(10 * Math.Pow(1.2, 3), s.Map.Camera.Zoom, 3);
        var after = s.Map.Camera.ScreenToWorld(local.X, local.Y);
        Assert.Equal(before.X, after.X, 6);
        Assert.Equal(before.Y, after.Y, 6);

        s.Key(Key.OemMinus);
        Assert.Equal(10 * Math.Pow(1.2, 3) / 1.25, s.Map.Camera.Zoom, 3);
    }

    [AvaloniaFact]
    public void RightDrag_Pans_AndKeyboardPans()
    {
        using var s = new TestSession();
        s.Show();
        s.Map.Camera.CenterOn(64, 64);
        s.Map.Camera.Zoom = 20;
        s.Frame();
        var from = s.Map.TranslatePoint(new Point(400, 300), s.Window)!.Value;
        s.Window.MouseDown(from, MouseButton.Right, RawInputModifiers.None);
        s.Window.MouseMove(from + new Vector(-100, -60), RawInputModifiers.RightMouseButton);
        s.Window.MouseUp(from + new Vector(-100, -60), MouseButton.Right, RawInputModifiers.None);
        TestSession.Pump();
        // Dragging the map left/up moves the view right/down by the same screen distance.
        Assert.Equal(64 + 100 / 20.0, s.Map.Camera.CenterX, 6);
        Assert.Equal(64 + 60 / 20.0, s.Map.Camera.CenterY, 6);

        double x = s.Map.Camera.CenterX;
        s.Window.KeyPress(Key.D, RawInputModifiers.None, PhysicalKey.D, "d");
        for (int i = 0; i < 5; i++)
        {
            Thread.Sleep(20);
            s.Map.RefreshFrame();
        }

        s.Window.KeyRelease(Key.D, RawInputModifiers.None, PhysicalKey.D, "d");
        TestSession.Pump();
        Assert.True(s.Map.Camera.CenterX > x + 1, $"D did not pan right ({x} -> {s.Map.Camera.CenterX})");
        double settled = s.Map.Camera.CenterX;
        s.Map.RefreshFrame();
        Assert.Equal(settled, s.Map.Camera.CenterX, 9);
    }

    [AvaloniaFact]
    public void EscapeCancelsADrag_ThenSwitchesBackToSelect()
    {
        using var s = new TestSession();
        s.Show();
        var (x, y) = s.Read(sim => MapSearch.BuildableArea(sim, 10));
        s.Map.Camera.CenterOn(x + 5, y + 5);
        s.Map.Camera.Zoom = 24;
        s.Frame();
        s.Key(Key.D1);
        s.Window.MouseDown(s.TilePoint(x, y), MouseButton.Left, RawInputModifiers.None);
        s.Window.MouseMove(s.TilePoint(x + 6, y), RawInputModifiers.LeftMouseButton);
        TestSession.Pump();
        Assert.True(s.Map.IsDragging);
        s.Key(Key.Escape);
        Assert.False(s.Map.IsDragging);
        Assert.Equal(ToolKind.Street, s.Vm.ActiveTool.Kind);
        s.Window.MouseUp(s.TilePoint(x + 6, y), MouseButton.Left, RawInputModifiers.None);
        TestSession.Pump();
        Assert.Equal(RoadType.None, s.Read(sim => sim.Map.Roads[sim.Map.Index(x + 3, y)]));

        s.Key(Key.Escape);
        Assert.Equal(ToolKind.Select, s.Vm.ActiveTool.Kind);
    }

    [AvaloniaFact]
    public void EveryToolHasAWorkingShortcut()
    {
        using var s = new TestSession();
        s.Show();
        foreach (var tool in ToolCatalog.All)
        {
            s.Key(tool.Shortcut);
            Assert.Equal(tool.Kind, s.Vm.ActiveTool.Kind);
            Assert.True(s.Vm.ToolItems.Single(i => i.Kind == tool.Kind).IsActive);
        }

        s.Key(Key.D4);
        Assert.Equal(ToolKind.Bulldoze, s.Vm.ActiveTool.Kind);
    }
}
