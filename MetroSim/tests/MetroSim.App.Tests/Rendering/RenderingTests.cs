using System.Diagnostics;
using Avalonia.Headless.XUnit;
using MetroSim.App.Game;
using MetroSim.App.Rendering;
using MetroSim.App.Tests.Support;
using MetroSim.App.Tools;
using MetroSim.Core.Engine;
using MetroSim.Core.Mathematics;
using MetroSim.Core.World;
using SkiaSharp;

namespace MetroSim.App.Tests.Rendering;

/// <summary>Renderer building blocks: interpolation, chunk invalidation, off-screen drawing and frame cost.</summary>
public sealed class RenderingTests(ITestOutputHelper output)
{
    [Fact]
    public void VehicleSprite_WalksItsPolylineByDistance()
    {
        var sprite = new VehicleSprite { PointCount = 3, StartHeading = Direction.East, EndHeading = Direction.South };
        sprite.SetPoint(0, 0, 0);
        sprite.SetPoint(1, 1, 0);
        sprite.SetPoint(2, 1, 1);

        var start = sprite.Evaluate(0);
        var quarter = sprite.Evaluate(0.25f);
        var corner = sprite.Evaluate(0.5f);
        var late = sprite.Evaluate(0.75f);
        var end = sprite.Evaluate(1);
        Assert.Equal((0f, 0f), (start.X, start.Y));
        Assert.Equal(0.5f, quarter.X, 3);
        Assert.True(quarter.Horizontal);
        Assert.Equal((1f, 0f), (corner.X, corner.Y));
        Assert.Equal((1f, 0.5f), (late.X, late.Y));
        Assert.False(late.Horizontal);
        Assert.Equal((1f, 1f), (end.X, end.Y));
    }

    [Fact]
    public void FrameInterpolation_RunsFromPreviousToCurrentTickOverTheTickInterval()
    {
        long now = Stopwatch.GetTimestamp();
        var frame = Frame(now, interval: 0.1, paused: false);
        Assert.Equal(0, frame.InterpolationAt(now), 3);
        Assert.Equal(0.5, frame.InterpolationAt(now + Stopwatch.Frequency / 20), 2);
        Assert.Equal(1, frame.InterpolationAt(now + Stopwatch.Frequency));
        Assert.Equal(1, Frame(now, 0.1, paused: true).InterpolationAt(now));
    }

    [Fact]
    public void LaneOffsets_KeepCarsOnTheRightHandSide()
    {
        var map = new CityMap(8, 8);
        for (int x = 0; x < 8; x++)
        {
            map.Roads[map.Index(x, 3)] = RoadType.Street;
        }

        int[] eastbound = [map.Index(2, 3), map.Index(3, 3)];
        int[] westbound = [map.Index(3, 3), map.Index(2, 3)];
        var east = VehicleTracker.Position(map, eastbound, 0, 500, Core.Traffic.VehicleKind.Car, 1);
        var west = VehicleTracker.Position(map, westbound, 0, 500, Core.Traffic.VehicleKind.Car, 1);
        // Screen y grows downwards: eastbound traffic drives on the south half, westbound on the north half.
        Assert.Equal(3.5f + VehicleTracker.StreetLane, east.Y, 4);
        Assert.Equal(3.5f - VehicleTracker.StreetLane, west.Y, 4);
        Assert.Equal(3.0f, east.X, 4);
        Assert.Equal(3.0f, west.X, 4);
    }

    [Fact]
    public void StaticSnapshots_OnlyRestampChangedChunks_AndShareUnchangedLayers()
    {
        var (sim, _) = GameSession.CreateSimulation(new NewGameSettings(3, 64, false, false));
        var builder = new StaticSnapshotBuilder();
        var first = builder.Build(sim);
        Assert.False(builder.IsStale(sim));

        sim.Execute(new BuildRoadCommand(20, 20, 24, 20, RoadType.Street));
        Assert.True(builder.IsStale(sim));
        var second = builder.Build(sim);

        int changed = Enumerable.Range(0, first.ChunkStamps.Length).Count(i => first.ChunkStamps[i] != second.ChunkStamps[i]);
        Assert.Equal(1, changed);
        Assert.NotEqual(first.ChunkStamps[1 * first.ChunksX + 1], second.ChunkStamps[1 * second.ChunksX + 1]);
        Assert.Same(first.Terrain, second.Terrain);
        Assert.Same(first.Elevation, second.Elevation);
        Assert.NotSame(first.Roads, second.Roads);
        Assert.Equal(RoadType.None, first.Roads[sim.Map.Index(22, 20)]);
        Assert.Equal(RoadType.Street, second.Roads[sim.Map.Index(22, 20)]);
    }

    [Fact]
    public void Renderer_DrawsADemoCityOffScreen_AtEveryChunkLevel()
    {
        var (sim, mayor) = GameSession.CreateSimulation(new NewGameSettings(42, 64, true, true));
        Core.Scenarios.DemoCity.Run(sim, mayor!, Simulation.TicksPerDay + 8 * 60);
        using var runner = new SimulationRunner(sim);
        var builder = new FrameBuilder();
        using var renderer = new MapRenderer { ChunkPaintBudgetMilliseconds = double.PositiveInfinity };
        using var surface = SKSurface.Create(new SKImageInfo(640, 400, SKImageInfo.PlatformColorType, SKAlphaType.Premul));
        foreach (double zoom in new[] { 2.0, 5.0, 9.0, 14.0, 30.0, 60.0 })
        {
            var camera = new CameraView(32, 32, zoom, 640, 400);
            renderer.Render(surface.Canvas, builder.Build(runner, camera, OverlayKind.None, null, MapSelection.None, false));
            using var image = surface.Snapshot();
            using var pixmap = image.PeekPixels();
            // The centre shows the city, not the empty background.
            Assert.NotEqual(Palette.Background, pixmap.GetPixelColor(320, 200));
        }

        Assert.True(renderer.Stats.CachedChunks > 0);
        Assert.Equal(6, renderer.Stats.Frames);
    }

    [AvaloniaFact]
    public void FrameTime_OfTheDemoCityWindow_IsMeasured()
    {
        using var s = new TestSession(new AppOptions { Seed = 42, MapSize = 128, DemoCity = true, AutoMayor = true, WarmupDays = 2 });
        s.Show();
        s.Step(8 * 60);
        s.Map.Camera.Zoom = 14;
        s.Frame();
        s.Map.Renderer.ChunkPaintBudgetMilliseconds = 6;
        s.Map.Renderer.Stats.ResetFrameTimes();

        const int frames = 60;
        long drawnBefore = s.Map.Renderer.Stats.Frames;
        var watch = Stopwatch.StartNew();
        for (int i = 0; i < frames; i++)
        {
            // One simulation tick every other frame (about 1x speed at 30 FPS) and a slow pan.
            if (i % 2 == 0)
            {
                s.Runner.StepNow(1);
            }

            s.Map.Camera.CenterX += 0.05;
            s.Map.RefreshFrame();
            TestSession.Pump();
        }

        double wall = watch.Elapsed.TotalMilliseconds;
        long drawn = s.Map.Renderer.Stats.Frames - drawnBefore;
        var (avg, max) = s.Map.Renderer.Stats.FrameMilliseconds;
        output.WriteLine($"{drawn} map frames drawn in {wall:0} ms of wall time ({wall / frames:0.0} ms per headless window frame incl. UI composition)");
        output.WriteLine($"map draw: {avg:0.00} ms avg, {max:0.00} ms max; snapshot {s.Map.Renderer.Stats.SnapshotMilliseconds:0.000} ms; vehicles drawn {s.Map.Renderer.Stats.VisibleVehicles}");
        Assert.True(drawn >= frames / 2, $"only {drawn} frames were drawn");
        Assert.True(avg < 50, $"map draw too slow: {avg:0.0} ms");
    }

    private static FrameSnapshot Frame(long seen, double interval, bool paused) => new()
    {
        Camera = new CameraView(0, 0, 10, 100, 100),
        Static = new StaticSnapshotBuilder().Build(GameSession.CreateSimulation(new NewGameSettings(1, 32, false, false)).Simulation),
        Vehicles = [],
        VehicleCount = 0,
        TickSeenTimestamp = seen,
        TickIntervalSeconds = interval,
        Paused = paused,
        Fires = [],
        Alerts = [],
    };
}
