using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using MetroSim.App.Rendering;
using MetroSim.App.Tests.Support;
using MetroSim.App.Tools;
using MetroSim.App.ViewModels;
using MetroSim.Core.Engine;

namespace MetroSim.App.Tests.Ui;

/// <summary>A running demo city: commuting traffic, overlays and dashboards.</summary>
public sealed class CityLifeTests
{
    private static readonly AppOptions DemoCity = new() { Seed = 42, MapSize = 128, DemoCity = true, AutoMayor = true };

    /// <summary>Steps to <paramref name="day"/> (0-based) at the given time of day.</summary>
    private static void StepTo(TestSession s, int day, int hour, int minute = 0)
    {
        long target = day * (long)Simulation.TicksPerDay + hour * 60 + minute;
        long now = s.Read(sim => sim.Tick);
        s.Step((int)(target - now));
    }

    [AvaloniaFact]
    public void Vehicles_AppearDuringTheMorningCommute_AndCanBeInspected()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        StepTo(s, 1, 3);
        Assert.Equal(0, s.Map.CurrentFrame!.VehicleCount);

        StepTo(s, 1, 7, 40);
        var frame = s.Map.CurrentFrame!;
        Assert.True(frame.VehicleCount > 0, "no vehicles on the road at 07:40");
        Assert.True(frame.Vehicles.Take(frame.VehicleCount).Any(v => v.Kind == SpriteKind.Car), "no cars");

        // Every sprite sits on (or right next to) a road tile: lane offsets stay inside the road.
        var stat = frame.Static;
        foreach (var v in frame.Vehicles.Take(frame.VehicleCount))
        {
            var (x, y, _) = v.Evaluate(1);
            Assert.True(stat.IsRoad((int)Math.Floor(x), (int)Math.Floor(y)), $"vehicle {v.Id} at ({x:0.00}, {y:0.00}) is off the road");
        }

        // Zoom onto a car, click it with the select tool: the inspector shows the trip and the route is highlighted.
        var car = frame.Vehicles.Take(frame.VehicleCount).First(v => v.Kind == SpriteKind.Car);
        var (cx, cy, _) = car.Evaluate(1);
        s.Map.Camera.CenterOn(cx, cy);
        s.Map.Camera.Zoom = 34;
        s.Frame();
        var point = s.Map.TranslatePoint(s.Map.TileCenter((int)Math.Floor(cx), (int)Math.Floor(cy)) - new Vector(0.5, 0.5) * 34 + new Vector(cx - Math.Floor(cx), cy - Math.Floor(cy)) * 34, s.Window)!.Value;
        s.Window.MouseDown(point, MouseButton.Left, RawInputModifiers.None);
        s.Window.MouseUp(point, MouseButton.Left, RawInputModifiers.None);
        s.Frame();
        Assert.Equal(SelectionKind.Vehicle, s.Vm.Selection.Kind);
        Assert.Equal(car.Id, s.Vm.Selection.Id);
        Assert.Equal((int)PanelKind.Inspector, s.Vm.SelectedPanel);
        Assert.Equal("Car", s.Vm.Inspector.Title);
        Assert.Contains(s.Vm.Inspector.Lines, l => l.Label == "Owner" && l.Value.StartsWith("Citizen #"));
        Assert.NotNull(s.Map.CurrentFrame!.Selection?.RouteTiles);
        s.Screenshot("06-commute-close-up");
    }

    [AvaloniaFact]
    public void DemoCityAtDayThree_TrafficOverlay_Renders()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        StepTo(s, 2, 8);
        s.Map.Camera.Zoom = 11;
        using var plain = s.Capture();
        s.Screenshot("07-demo-day3");

        s.Key(Key.D1, RawInputModifiers.Shift);
        Assert.Equal(OverlayKind.Traffic, s.Vm.Overlay);
        using var traffic = s.Capture();
        Assert.Equal(OverlayKind.Traffic, s.Map.CurrentFrame!.Overlay?.Kind);
        Assert.True(Pixels.Differences(plain, traffic) > 20_000, "the traffic overlay did not change the picture");
        Assert.True(s.Window.GetVisualDescendants().OfType<TextBlock>().Any(t => t.Text == "jammed" && t.IsEffectivelyVisible), "legend missing");
        s.Screenshot("08-demo-day3-traffic-overlay");

        // Pressing the same hotkey again turns the overlay off; the combo box shows the same state.
        s.Key(Key.D1, RawInputModifiers.Shift);
        Assert.Equal(OverlayKind.None, s.Vm.Overlay);
        Assert.Null(s.Map.CurrentFrame!.Overlay);
    }

    [AvaloniaFact]
    public void EveryOverlay_RendersItsOwnLayer()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        StepTo(s, 2, 12);
        s.Map.Camera.Zoom = 11;
        using var plain = s.Capture();
        foreach (var info in OverlayInfo.All.Skip(1))
        {
            s.Vm.SelectedOverlay = info;
            using var frame = s.Capture();
            var layer = s.Map.CurrentFrame!.Overlay;
            Assert.NotNull(layer);
            Assert.Equal(info.Kind, layer.Kind);
            Assert.Contains(layer.Pixels, p => p != 0);
            Assert.True(Pixels.Differences(plain, frame) > 5_000, $"{info.Title} overlay did not change the picture");
            if (info.Kind is OverlayKind.Electricity or OverlayKind.LandValue or OverlayKind.Pollution or OverlayKind.Zoning)
            {
                s.Screenshot("09-overlay-" + info.Kind.ToString().ToLowerInvariant());
            }
        }
    }

    [AvaloniaFact]
    public void FinanceDashboard_ShowsTheLedger_AndTaxSlidersIssueCommands()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        StepTo(s, 3, 9);
        s.Key(Key.F2);
        Assert.Equal((int)PanelKind.Finance, s.Vm.SelectedPanel);
        var finance = s.Vm.Finance;
        Assert.Equal(10, finance.Rows.Count);
        Assert.Equal("Day 3 ledger", finance.LedgerTitle);
        Assert.Equal(3, finance.Chart.Count);
        Assert.Equal(3, finance.Chart[0].Values.Count);
        long income = s.Read(sim => sim.Budget.History[^1].ResidentialTax);
        Assert.Equal(Game.Format.Money(income), finance.Rows[0].Amount);

        var slider = s.Window.GetVisualDescendants().OfType<Slider>().Single(x => x.Name == "ResidentialTaxSlider");
        Assert.True(slider.IsEffectivelyVisible);
        slider.Value = 13;
        TestSession.Pump();
        Assert.Equal(13, s.Read(sim => sim.Budget.ResidentialTax));
        Assert.Equal("Residential tax set to 13%.", s.Vm.StatusText);
        Assert.Contains(s.Read(sim => sim.CommandLog), c => c.Command is SetTaxCommand { Percent: 13 });
        s.Screenshot("10-finance-dashboard");

        s.Key(Key.F4);
        Assert.Contains(s.Vm.Traffic.Lines, l => l.Label == "Travel time index");
        Assert.Equal(3, s.Vm.Traffic.Chart.Count);
        s.Screenshot("11-traffic-dashboard");
        s.Key(Key.F3);
        Assert.Contains(s.Vm.City.Lines, l => l.Label == "Population" && !l.Value.StartsWith("0 "));
        s.Key(Key.F6);
        Assert.Contains(s.Vm.Performance.Lines, l => l.Label == "Pathfinding" && !l.Value.StartsWith("0 searches"));
        s.Screenshot("12-performance-dashboard");
    }

    [AvaloniaFact]
    public void DemoCity_KeepsGrowingOverTenDays_AndTheMapFollows()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        StepTo(s, 2, 12);
        int early = s.Map.CurrentFrame!.Static.Buildings.Count(b => b.Exists);
        StepTo(s, 9, 17, 30);
        var frame = s.Map.CurrentFrame!;
        int later = frame.Static.Buildings.Count(b => b.Exists);
        Assert.True(later > early, $"buildings {early} -> {later}");
        Assert.True(frame.Static.Buildings.Any(b => b.Exists && b.Level >= 2), "no building levelled up in ten days");
        Assert.True(frame.VehicleCount > 0, "no evening traffic");
        Assert.True(s.Read(sim => sim.Stats.Population) > 1000);
        s.Map.Camera.Zoom = 13;
        s.Screenshot("15-demo-day10-evening");
        s.Map.Camera.Zoom = 30;
        s.Screenshot("16-demo-day10-close-up");
    }

    [AvaloniaFact]
    public void SelectingABuilding_ShowsItsDetails_AndEventsCentreTheMap()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        StepTo(s, 1, 12);
        var home = s.Read(sim => sim.Buildings.All().First(b => b.Kind == Core.Buildings.BuildingKind.Residential && b.IsComplete));
        s.Map.Camera.CenterOn(home.X + 0.5, home.Y + 0.5);
        s.Map.Camera.Zoom = 30;
        s.Frame();
        s.Key(Key.Q);
        s.ClickTile(home.X, home.Y);
        Assert.Equal(new MapSelection(SelectionKind.Building, home.Id, s.Read(sim => sim.Map.Index(home.X, home.Y))), s.Vm.Selection);
        Assert.StartsWith("Residential building, level", s.Vm.Inspector.Title);
        Assert.Contains(s.Vm.Inspector.Lines, l => l.Label == "Residents");
        Assert.Contains(s.Vm.Inspector.Lines, l => l.Label == "Power");
        Assert.Contains(s.Vm.Inspector.Lines, l => l.Label == "Road access" && l.Value.StartsWith("via"));
        s.Screenshot("13-inspector-building");

        // A located event recentres the camera on its tile.
        int tile = s.Read(sim => sim.Map.Index(10, 20));
        s.Vm.CenterOnEvent(new EventItem("Day 2", "test", EventSeverity.Warning, tile));
        TestSession.Pump();
        Assert.Equal(10.5, s.Map.Camera.CenterX, 3);
        Assert.Equal(20.5, s.Map.Camera.CenterY, 3);
    }
}
