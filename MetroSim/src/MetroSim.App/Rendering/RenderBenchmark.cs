using System.Diagnostics;
using MetroSim.App.Game;
using MetroSim.App.Tools;
using MetroSim.Core.Engine;
using SkiaSharp;

namespace MetroSim.App.Rendering;

/// <summary>
/// <c>--benchmark-render [frames]</c>: builds the demo city (by default up to day 4, 08:00, the morning
/// rush hour; <c>--days</c> overrides), then renders frames with the real <see cref="FrameBuilder"/> and
/// <see cref="MapRenderer"/> into an off-screen CPU raster surface and reports snapshot and draw times
/// per scenario. No window or GPU is involved, so the numbers are the renderer's own cost on one core.
/// </summary>
public static class RenderBenchmark
{
    public static int Run(AppOptions options, TextWriter output)
    {
        int frames = options.BenchmarkFrames ?? 300;
        // Default: day 4 at 08:00, so commuters are on the road.
        double days = options.WarmupDays > 0 ? options.WarmupDays : 3 + 8 / 24.0;
        var settings = new NewGameSettings(options.Seed ?? 42, options.MapSize, DemoCity: true, AutoMayor: true);
        var watch = Stopwatch.StartNew();
        var (sim, mayor) = GameSession.CreateSimulation(settings);
        int ticks = (int)Math.Round(days * Simulation.TicksPerDay);
        for (int i = 0; i < ticks; i++)
        {
            sim.Step();
            if (sim.Tick % Simulation.TicksPerHour == 0)
            {
                mayor?.Manage();
            }
        }

        output.WriteLine($"Demo city seed {settings.Seed}, {settings.MapSize}x{settings.MapSize}, simulated to {Format.Date(sim.Tick)} in {watch.ElapsedMilliseconds} ms: " +
            $"population {sim.Stats.Population}, {sim.Buildings.Count} buildings, {sim.Traffic.Vehicles.Count} vehicles.");
        output.WriteLine($"Rendering {frames} frames per scenario at {options.BenchmarkWidth}x{options.BenchmarkHeight} (CPU raster, single thread).");
        output.WriteLine();
        output.WriteLine("scenario                     | zoom | first frame ms | snapshot ms avg | draw ms avg | draw ms p95 | draw ms max | FPS (draw+snapshot)");

        var (cx, cy) = CityCentre(sim);
        double fit = Math.Min(options.BenchmarkWidth / (double)sim.Map.Width, options.BenchmarkHeight / (double)sim.Map.Height);
        var (mapWidth, mapHeight) = (sim.Map.Width, sim.Map.Height);

        // From here on the simulation belongs to the runner: state is only read under its lock.
        using var runner = new SimulationRunner(sim);
        var info = new SKImageInfo(options.BenchmarkWidth, options.BenchmarkHeight, SKImageInfo.PlatformColorType, SKAlphaType.Premul);
        using var surface = SKSurface.Create(info);
        double zoom = options.Zoom ?? 14;

        Scenario(output, "city, no overlay", runner, surface, frames, zoom, cx, cy, OverlayKind.None, stepEvery: 5);
        Scenario(output, "city, traffic overlay", runner, surface, frames, zoom, cx, cy, OverlayKind.Traffic, stepEvery: 5);
        Scenario(output, "close-up (40 px/tile)", runner, surface, frames, 40, cx, cy, OverlayKind.None, stepEvery: 5);
        Scenario(output, "whole map", runner, surface, frames, fit, mapWidth / 2.0, mapHeight / 2.0, OverlayKind.None, stepEvery: 5);
        Scenario(output, "city, sim at max speed", runner, surface, frames, zoom, cx, cy, OverlayKind.None, stepEvery: 0, background: true);
        return 0;
    }

    private static void Scenario(TextWriter output, string name, SimulationRunner runner, SKSurface surface, int frames,
        double zoom, double cx, double cy, OverlayKind overlay, int stepEvery, bool background = false)
    {
        var builder = new FrameBuilder();
        using var renderer = new MapRenderer { ChunkPaintBudgetMilliseconds = double.PositiveInfinity };
        var canvas = surface.Canvas;
        var size = surface.Canvas.DeviceClipBounds;
        var camera = new Camera { ViewWidth = size.Width, ViewHeight = size.Height, Zoom = zoom, CenterX = cx, CenterY = cy };

        // First frame paints every visible chunk (cold cache).
        var start = Stopwatch.GetTimestamp();
        renderer.Render(canvas, builder.Build(runner, camera.View, overlay, null, MapSelection.None, false));
        double first = Stopwatch.GetElapsedTime(start).TotalMilliseconds;

        if (background)
        {
            runner.Speed = SimulationSpeed.Unlimited;
        }

        var draw = new double[frames];
        double snapshotTotal = 0;
        for (int i = 0; i < frames; i++)
        {
            if (stepEvery > 0 && i % stepEvery == 0)
            {
                runner.StepNow(1);
            }

            // Drift the camera a little each frame, like a player panning.
            camera.CenterX = cx + Math.Sin(i * 0.05) * 3;
            camera.CenterY = cy + Math.Cos(i * 0.04) * 2;
            var t0 = Stopwatch.GetTimestamp();
            var frame = builder.Build(runner, camera.View, overlay, null, MapSelection.None, false);
            var t1 = Stopwatch.GetTimestamp();
            renderer.Render(canvas, frame);
            canvas.Flush();
            var t2 = Stopwatch.GetTimestamp();
            snapshotTotal += (t1 - t0) * 1000.0 / Stopwatch.Frequency;
            draw[i] = (t2 - t1) * 1000.0 / Stopwatch.Frequency;
        }

        runner.Speed = SimulationSpeed.Paused;
        Array.Sort(draw);
        double avg = draw.Average();
        double snapshot = snapshotTotal / frames;
        output.WriteLine(
            $"{name,-28} | {zoom,4:0.#} | {first,14:0.0} | {snapshot,15:0.000} | {avg,11:0.00} | {draw[(int)(frames * 0.95)],11:0.00} | {draw[^1],11:0.00} | {1000 / (avg + snapshot),8:0}");
    }

    private static (double X, double Y) CityCentre(Simulation sim)
    {
        double sx = 0;
        double sy = 0;
        int n = 0;
        foreach (var b in sim.Buildings)
        {
            sx += b.X + b.Size / 2.0;
            sy += b.Y + b.Size / 2.0;
            n++;
        }

        return n == 0 ? (sim.Map.Width / 2.0, sim.Map.Height / 2.0) : (sx / n, sy / n);
    }
}
