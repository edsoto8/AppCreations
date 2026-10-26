using Avalonia;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Avalonia.Input;
using MetroSim.App.Rendering;
using MetroSim.App.Tests.Support;
using MetroSim.App.Tools;
using MetroSim.Core.Buildings;
using MetroSim.Core.World;

namespace MetroSim.App.Tests.Ui;

/// <summary>The core loop through the real window: generate, build roads, zone, grow, place services.</summary>
public sealed class BuildingTheCityTests
{
    [AvaloniaFact]
    public void App_StartsStraightIntoAGeneratedMap()
    {
        using var s = new TestSession(new AppOptions { Seed = 2024, MapSize = 128 });
        s.Show();

        var frame = s.Map.CurrentFrame;
        Assert.NotNull(frame);
        Assert.Equal(128, frame.Static.Width);
        Assert.Equal(128, frame.Static.Height);
        Assert.Contains("$70,000", s.Vm.MoneyText);
        Assert.Equal("Day 1 · 00:00", s.Vm.DateText);

        // The map area is drawn (terrain, not the empty background colour).
        using var bitmap = s.Capture();
        var centre = s.Map.TranslatePoint(new Point(s.Map.Bounds.Width / 2, s.Map.Bounds.Height / 2), s.Window)!.Value;
        var (r, g, b) = Pixels.At(bitmap, centre);
        Assert.False(r == 0x14 && g == 0x1A && b == 0x22, "map centre shows the background, not terrain");
        Assert.True(s.Map.Renderer.Stats.Frames > 0);
        s.Screenshot("01-new-map");
    }

    [AvaloniaFact]
    public void DraggingWithTheStreetTool_BuildsAConnectedRoad()
    {
        using var s = new TestSession();
        s.Show();
        var (x, y) = s.Read(sim => MapSearch.BuildableArea(sim, 14));
        s.Map.Camera.CenterOn(x + 7, y + 7);
        s.Map.Camera.Zoom = 24;
        s.Frame();
        long moneyBefore = s.Read(sim => sim.Budget.Money);

        s.Key(Key.D1);
        Assert.Equal(ToolKind.Street, s.Vm.ActiveTool.Kind);

        ToolPreview? preview = null;
        s.DragTiles(x, y, x + 12, y + 6, beforeRelease: () => preview = s.Map.Preview);

        // The preview showed an L-shaped ghost with its cost before the release committed it.
        Assert.NotNull(preview);
        Assert.True(preview.Valid);
        Assert.Equal(2, preview.Rects.Count);
        Assert.Contains("19 tiles", preview.Label);
        Assert.Contains("$475", preview.Label);

        var (roads, money) = s.Read(sim =>
        {
            var path = Core.Engine.CommandPaths.LPath(x, y, x + 12, y + 6);
            return (path.Count(p => sim.Map.Roads[sim.Map.Index(p.X, p.Y)] == RoadType.Street), sim.Budget.Money);
        });
        Assert.Equal(19, roads);
        Assert.Equal(moneyBefore - 19 * 2_500, money);
        Assert.Contains("Built 19 road tiles", s.Vm.StatusText);
        Assert.False(s.Vm.StatusIsError);
        Assert.True(s.Read(sim => sim.Roads.Connected(sim.Map.Index(x, y), sim.Map.Index(x + 12, y + 6))));
        s.Screenshot("02-road-built");
    }

    [AvaloniaFact]
    public void ZoningNextToARoad_ThenSteppingTheRunner_GrowsBuildings()
    {
        using var s = new TestSession();
        s.Show();
        var (x, y) = s.Read(sim => MapSearch.BuildableArea(sim, 14));
        s.Map.Camera.CenterOn(x + 7, y + 4);
        s.Map.Camera.Zoom = 28;
        s.Frame();

        s.Key(Key.D1);
        s.DragTiles(x, y + 3, x + 12, y + 3);
        s.Key(Key.D5);
        Assert.Equal(ToolKind.ZoneResidential, s.Vm.ActiveTool.Kind);
        s.DragTiles(x, y + 1, x + 12, y + 2);
        s.Key(Key.D6);
        s.DragTiles(x, y + 4, x + 5, y + 5);
        s.Key(Key.D7);
        s.DragTiles(x + 7, y + 4, x + 12, y + 5);

        int zoned = s.Read(sim => Enumerable.Range(0, sim.Map.TileCount).Count(t => sim.Map.Zones[t] != ZoneType.None));
        Assert.Equal(26 + 12 + 12, zoned);
        s.Key(Key.D4, RawInputModifiers.Shift);
        Assert.Equal(OverlayKind.Zoning, s.Vm.Overlay);
        s.Screenshot("03-zoned");
        s.Key(Key.D4, RawInputModifiers.Shift);
        Assert.Equal(OverlayKind.None, s.Vm.Overlay);

        // Six game hours: demand is positive in a new city, so homes spawn and finish construction.
        s.Step(6 * 60);
        var (residential, complete) = s.Read(sim => (
            sim.Buildings.All().Count(b => b.Kind == BuildingKind.Residential),
            sim.Buildings.All().Count(b => b.IsComplete)));
        Assert.True(residential > 0, "no homes grew on the residential zone");
        Assert.True(complete > 0, "no building finished construction");
        Assert.True(s.Map.CurrentFrame!.Static.Buildings.Count(b => b.Exists) >= residential);
        s.Map.Camera.Zoom = 40;
        s.Screenshot("04-growth-close-up");
    }

    [AvaloniaFact]
    public void ServiceBuildingTool_ShowsAGhostWithItsCost_AndClickPlacesIt()
    {
        using var s = new TestSession();
        s.Show();
        var (x, y) = s.Read(sim => MapSearch.BuildableArea(sim, 8));
        s.Map.Camera.CenterOn(x + 4, y + 4);
        s.Map.Camera.Zoom = 24;
        s.Frame();

        s.Key(Key.C);
        Assert.Equal(ToolKind.CoalPlant, s.Vm.ActiveTool.Kind);
        s.Window.MouseMove(s.TilePoint(x + 2, y + 2), RawInputModifiers.None);
        s.Frame();
        var ghost = s.Map.Preview;
        Assert.NotNull(ghost);
        Assert.True(ghost.Valid, ghost.Label);
        Assert.Equal(new TileRect(x + 1, y + 1, x + 3, y + 3), ghost.Rects[0]);
        Assert.Contains("$20,000", ghost.Label);
        s.Screenshot("05-coal-plant-ghost");

        s.ClickTile(x + 2, y + 2);
        var plant = s.Read(sim => sim.Buildings.All().FirstOrDefault(b => b.Kind == BuildingKind.CoalPlant));
        Assert.NotNull(plant);
        Assert.Equal((x + 1, y + 1), (plant.X, plant.Y));
        Assert.Contains("Placed Coal Power Plant", s.Vm.StatusText);

        // Placing again on top is refused and the reason is shown.
        s.ClickTile(x + 2, y + 2);
        Assert.True(s.Vm.StatusIsError);
        Assert.Contains("in the way", s.Vm.StatusText);
    }

    [AvaloniaFact]
    public void CommandFailures_AreShownInTheStatusLine()
    {
        using var s = new TestSession();
        s.Show();
        var (x, y) = s.Read(sim => MapSearch.BuildableArea(sim, 10));
        s.Map.Camera.CenterOn(x + 5, y + 5);
        s.Map.Camera.Zoom = 24;
        s.Frame();
        lock (s.Runner.StateLock)
        {
            s.Runner.Simulation.Budget.Money = 100;
        }

        s.Key(Key.D2);
        ToolPreview? preview = null;
        s.DragTiles(x, y, x + 8, y, beforeRelease: () => preview = s.Map.Preview);
        Assert.NotNull(preview);
        Assert.False(preview.Valid);
        Assert.StartsWith("Not enough money.", preview.Label);
        Assert.True(s.Vm.StatusIsError);
        Assert.Equal("Avenue: Not enough money.", s.Vm.StatusText);
        Assert.Equal(RoadType.None, s.Read(sim => sim.Map.Roads[sim.Map.Index(x + 3, y)]));
    }

    [AvaloniaFact]
    public void Bulldozing_RemovesWhatTheRectangleCovers()
    {
        using var s = new TestSession();
        s.Show();
        var (x, y) = s.Read(sim => MapSearch.BuildableArea(sim, 10));
        s.Map.Camera.CenterOn(x + 5, y + 5);
        s.Map.Camera.Zoom = 24;
        s.Frame();
        s.Key(Key.D1);
        s.DragTiles(x, y + 2, x + 9, y + 2);
        Assert.Equal(10, s.Read(sim => Enumerable.Range(x, 10).Count(i => sim.Map.Roads[sim.Map.Index(i, y + 2)] != RoadType.None)));

        s.Key(Key.B);
        Assert.Equal(ToolKind.Bulldoze, s.Vm.ActiveTool.Kind);
        s.DragTiles(x + 2, y + 1, x + 5, y + 3);
        Assert.Equal(6, s.Read(sim => Enumerable.Range(x, 10).Count(i => sim.Map.Roads[sim.Map.Index(i, y + 2)] != RoadType.None)));
        Assert.Contains("Bulldozed", s.Vm.StatusText);
    }
}
