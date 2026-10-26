using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using MetroSim.App.Tests.Support;
using MetroSim.Core.Engine;

namespace MetroSim.App.Tests.Ui;

/// <summary>New game, save, load and quick save through the same commands and keys the player uses.</summary>
public sealed class GameFileTests
{
    private static readonly AppOptions DemoCity = new() { Seed = 42, MapSize = 128, DemoCity = true, AutoMayor = true };

    [AvaloniaFact]
    public async Task SaveAs_ThenLoad_RoundTripsTheCity()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        s.Step(Simulation.TicksPerDay + 9 * 60);
        string path = Path.Combine(s.Folder, "my city.city");
        s.Dialogs.NextSavePath = path;
        await s.Vm.SaveAsCommand.ExecuteAsync(null);
        Assert.True(File.Exists(path));
        Assert.False(s.Vm.StatusIsError, s.Vm.StatusText);
        Assert.StartsWith("Saved my city.city", s.Vm.StatusText);
        var (savedHash, savedTick, savedPopulation) = s.Read(sim => (sim.ComputeStateHash(), sim.Tick, sim.Stats.Population));

        // Change the city after saving: play on and bulldoze part of it.
        s.Step(120);
        s.Runner.Execute(new BulldozeCommand(0, 0, 127, 127));
        Assert.Equal(0, s.Read(sim => sim.Buildings.Count));

        s.Dialogs.NextOpenPath = path;
        await s.Vm.LoadCommand.ExecuteAsync(null);
        s.Frame();
        Assert.False(s.Vm.StatusIsError, s.Vm.StatusText);
        Assert.StartsWith("Loaded Demo City from my city.city", s.Vm.StatusText);
        Assert.Equal(savedHash, s.Read(sim => sim.ComputeStateHash()));
        Assert.Equal(savedTick, s.Read(sim => sim.Tick));
        Assert.Equal(savedPopulation.ToString("N0", System.Globalization.CultureInfo.InvariantCulture), s.Vm.PopulationText);
        Assert.Equal("Demo City", s.Vm.CityName);
        Assert.True(s.Map.CurrentFrame!.Static.Buildings.Count(b => b.Exists) > 0, "the map shows the loaded buildings");

        // The loaded city keeps running from where it was saved.
        s.Step(60);
        Assert.Equal(savedTick + 60, s.Read(sim => sim.Tick));

        // Plain Save now writes back to the loaded file without asking.
        s.Dialogs.NextSavePath = null;
        await s.Vm.SaveCommand.ExecuteAsync(null);
        Assert.StartsWith("Saved my city.city", s.Vm.StatusText);
    }

    [AvaloniaFact]
    public void QuickSaveAndQuickLoad_UseF5AndF9()
    {
        using var s = new TestSession(DemoCity);
        s.Show();
        s.Key(Key.F9);
        Assert.True(s.Vm.StatusIsError);
        Assert.Contains("No quick save", s.Vm.StatusText);

        s.Step(600);
        s.Key(Key.F5);
        Assert.StartsWith("Quick saved.", s.Vm.StatusText);
        Assert.True(File.Exists(s.Host.Session.QuickSavePath));
        string hash = s.Read(sim => sim.ComputeStateHash());

        s.Step(300);
        Assert.NotEqual(hash, s.Read(sim => sim.ComputeStateHash()));
        s.Key(Key.F9);
        Assert.False(s.Vm.StatusIsError, s.Vm.StatusText);
        Assert.Equal(hash, s.Read(sim => sim.ComputeStateHash()));
        Assert.Null(s.Host.Session.CurrentPath);
    }

    [AvaloniaFact]
    public async Task LoadingADamagedFile_ShowsTheSaveGameError_AndKeepsTheCity()
    {
        using var s = new TestSession();
        s.Show();
        string path = Path.Combine(s.Folder, "broken.city");
        File.WriteAllText(path, "this is not a city");
        string before = s.Read(sim => sim.ComputeStateHash());

        s.Dialogs.NextOpenPath = path;
        await s.Vm.LoadCommand.ExecuteAsync(null);
        Assert.True(s.Vm.StatusIsError);
        Assert.False(string.IsNullOrWhiteSpace(s.Vm.StatusText));
        Assert.Equal(before, s.Read(sim => sim.ComputeStateHash()));
    }

    [AvaloniaFact]
    public void CommandLineLoad_OpensTheSavedCity()
    {
        string folder = Path.Combine(Path.GetTempPath(), "metrosim-ui-tests", Guid.NewGuid().ToString("N"));
        string path = Path.Combine(folder, "cli.city");
        string hash;
        using (var first = new TestSession(DemoCity))
        {
            first.Step(500);
            Assert.True(first.Host.Session.Save(path).Success);
            hash = first.Read(sim => sim.ComputeStateHash());
        }

        var options = AppOptions.Parse(["--load", path, "--seed", "5"]);
        Assert.Equal(path, options.LoadPath);
        Assert.Equal(5UL, options.Seed);
        using var s = new TestSession(options);
        s.Show();
        Assert.Equal(hash, s.Read(sim => sim.ComputeStateHash()));
        Assert.StartsWith("Loaded", s.Vm.StatusText);
        Directory.Delete(folder, recursive: true);
    }

    [AvaloniaFact]
    public void NewGamePanel_GeneratesTheRequestedMap()
    {
        using var s = new TestSession();
        s.Show();
        s.Key(Key.N, RawInputModifiers.Control);
        Assert.True(s.Vm.NewGame.IsOpen);
        var panel = s.Window.GetVisualDescendants().OfType<Views.NewGamePanel>().Single();
        Assert.True(panel.IsEffectivelyVisible);

        var seedBox = panel.GetVisualDescendants().OfType<TextBox>().Single(t => t.Name == "SeedBox");
        seedBox.Text = "not a number";
        TestSession.Pump();
        Assert.False(s.Vm.NewGame.StartCommand.CanExecute(null));
        Assert.NotNull(s.Vm.NewGame.SeedError);

        seedBox.Text = "31337";
        panel.GetVisualDescendants().OfType<ComboBox>().Single(c => c.Name == "SizeBox").SelectedItem = 64;
        panel.GetVisualDescendants().OfType<CheckBox>().Single(c => c.Name == "DemoBox").IsChecked = true;
        TestSession.Pump();
        s.Screenshot("14-new-game-panel");
        var start = panel.GetVisualDescendants().OfType<Button>().Single(b => b.Name == "StartButton");
        s.Window.MouseDown(start.TranslatePoint(new Point(start.Bounds.Width / 2, start.Bounds.Height / 2), s.Window)!.Value, MouseButton.Left);
        s.Window.MouseUp(start.TranslatePoint(new Point(start.Bounds.Width / 2, start.Bounds.Height / 2), s.Window)!.Value, MouseButton.Left);
        s.Frame();

        Assert.False(s.Vm.NewGame.IsOpen);
        var (width, seed, roads) = s.Read(sim => (sim.Map.Width, sim.Settings.Seed, sim.Roads.RoadTiles));
        Assert.Equal(64, width);
        Assert.Equal(31337UL, seed);
        Assert.True(roads > 0, "the demo city was not laid out");
        Assert.Equal(64, s.Map.CurrentFrame!.Static.Width);
        Assert.True(s.Vm.AutoMayorAvailable);

        // Auto-mayor is a toggle bound to the session.
        s.Vm.AutoMayorEnabled = false;
        Assert.False(s.Host.Session.AutoMayorEnabled);
        s.Vm.AutoMayorEnabled = true;
        Assert.True(s.Host.Session.AutoMayorEnabled);
    }

    [AvaloniaFact]
    public void SpeedControls_DriveTheRunner()
    {
        using var s = new TestSession();
        s.Show();
        Assert.Equal(SimulationSpeed.Paused, s.Runner.Speed);
        s.Key(Key.Space);
        Assert.Equal(SimulationSpeed.Normal, s.Runner.Speed);
        s.Key(Key.D3, RawInputModifiers.Control);
        Assert.Equal(SimulationSpeed.Faster, s.Runner.Speed);
        Assert.True(s.Vm.Speeds.Single(o => o.Speed == SimulationSpeed.Faster).IsActive);
        s.Key(Key.Space);
        Assert.Equal(SimulationSpeed.Paused, s.Runner.Speed);
        s.Key(Key.Space);
        Assert.Equal(SimulationSpeed.Faster, s.Runner.Speed);

        // The background runner really advances time at this speed.
        long before = s.Read(sim => sim.Tick);
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (s.Read(sim => sim.Tick) < before + 30 && DateTime.UtcNow < deadline)
        {
            Thread.Sleep(20);
        }

        s.Vm.SetSpeed(SimulationSpeed.Paused);
        Assert.True(s.Read(sim => sim.Tick) >= before + 30, "the runner did not advance");
        s.Vm.Refresh();
        Assert.NotEqual("Day 1 · 00:00", s.Vm.DateText);
    }
}
