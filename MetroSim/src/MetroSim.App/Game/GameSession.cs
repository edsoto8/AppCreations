using System.Diagnostics;
using MetroSim.Core.Engine;
using MetroSim.Core.Scenarios;
using MetroSim.Core.World;
using MetroSim.Persistence;

namespace MetroSim.App.Game;

/// <summary>What the new-game screen asks for.</summary>
public sealed record NewGameSettings(ulong Seed, int MapSize, bool DemoCity, bool AutoMayor)
{
    public static readonly int[] MapSizes = [64, 128, 192, 256];

    public static ulong RandomSeed() => (ulong)Random.Shared.NextInt64(1, 1_000_000);
}

/// <summary>Outcome of a save or load, for the status line.</summary>
public sealed record FileResult(bool Success, string Message);

/// <summary>
/// The running game: owns the <see cref="SimulationRunner"/> and everything that swaps the simulation
/// (new game, load) or writes it out (save). The UI never steps the simulation itself; it reads state
/// under <see cref="SimulationRunner.StateLock"/> and issues commands through the runner.
/// </summary>
public sealed class GameSession : IDisposable
{
    public const string DefaultCityName = "New City";

    // The auto-mayor is bound to the simulation it was created for, so a stale one never acts on a
    // newly loaded city. Read and written as one reference (atomic) from both threads.
    private volatile MayorBinding? _mayor;
    private volatile bool _autoMayorEnabled;

    private GameSession(SimulationRunner runner, string savesDirectory)
    {
        Runner = runner;
        SavesDirectory = savesDirectory;
        Runner.HourlyHook = OnHour;
    }

    public SimulationRunner Runner { get; }

    public string CityName { get; set; } = DefaultCityName;

    /// <summary>File the city was last saved to or loaded from (Save writes here without asking).</summary>
    public string? CurrentPath { get; private set; }

    public string SavesDirectory { get; }

    public string QuickSavePath => Path.Combine(SavesDirectory, "quicksave" + SaveGameStore.FileExtension);

    public NewGameSettings? LastSettings { get; private set; }

    /// <summary>True when the current city has an auto-mayor (demo cities started in this session).</summary>
    public bool AutoMayorAvailable => _mayor is { } m && ReferenceEquals(m.Simulation, Runner.Simulation);

    public bool AutoMayorEnabled
    {
        get => _autoMayorEnabled && AutoMayorAvailable;
        set => _autoMayorEnabled = value;
    }

    /// <summary>Raised on the calling thread after a new or loaded simulation replaced the old one.</summary>
    public event Action? SimulationReplaced;

    public static string DefaultSavesDirectory() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MetroSim", "saves");

    public static GameSession Start(AppOptions options)
    {
        var settings = new NewGameSettings(options.Seed ?? NewGameSettings.RandomSeed(), options.MapSize, options.DemoCity, options.AutoMayor);
        var (sim, mayor) = CreateSimulation(settings);
        var session = new GameSession(new SimulationRunner(sim), options.SavesDirectory ?? DefaultSavesDirectory());
        session.Bind(settings, sim, mayor);
        return session;
    }

    /// <summary>Generates a map (and optionally lays out the demo city) without touching the runner.</summary>
    public static (Simulation Simulation, AutoMayor? Mayor) CreateSimulation(NewGameSettings settings)
    {
        var sim = Simulation.Create(new MapSettings { Width = settings.MapSize, Height = settings.MapSize, Seed = settings.Seed });
        if (!settings.DemoCity)
        {
            return (sim, null);
        }

        // The demo grid needs 6 blocks of 6 tiles; small maps get fewer blocks.
        int blocks = Math.Clamp((settings.MapSize - 8) / DemoCityPlan.BlockPitch, 2, 6);
        var plan = DemoCity.Build(sim, blocks);
        return (sim, new AutoMayor(sim, plan));
    }

    public void NewGame(NewGameSettings settings)
    {
        var (sim, mayor) = CreateSimulation(settings);
        Runner.Replace(sim);
        CurrentPath = null;
        Bind(settings, sim, mayor);
        SimulationReplaced?.Invoke();
    }

    /// <summary>Runs days synchronously (start-up warm-up, tests). The auto-mayor acts hourly.</summary>
    public void Warmup(double days)
    {
        int ticks = (int)Math.Round(days * Simulation.TicksPerDay);
        if (ticks > 0)
        {
            Runner.StepNow(ticks);
        }
    }

    /// <summary>
    /// Saves under the state lock so the file is one consistent tick. <paramref name="remember"/> makes
    /// the file the target of later plain saves (quick saves do not).
    /// </summary>
    public FileResult Save(string path, bool remember = true)
    {
        try
        {
            var watch = Stopwatch.StartNew();
            lock (Runner.StateLock)
            {
                SaveGameStore.Save(Runner.Simulation, path, CityName);
            }

            if (remember)
            {
                CurrentPath = path;
            }

            return new FileResult(true, $"Saved {Path.GetFileName(path)} ({watch.ElapsedMilliseconds} ms).");
        }
        catch (Exception ex) when (ex is SaveGameException or IOException or UnauthorizedAccessException)
        {
            return new FileResult(false, $"Could not save: {ex.Message}");
        }
    }

    public FileResult Load(string path, bool remember = true)
    {
        try
        {
            var watch = Stopwatch.StartNew();
            var summary = SaveGameStore.ReadSummary(path);
            var sim = SaveGameStore.Load(path);
            Runner.Replace(sim);
            CurrentPath = remember ? path : null;
            CityName = summary.CityName;
            LastSettings = new NewGameSettings(sim.Settings.Seed, sim.Map.Width, false, false);
            _mayor = null;
            SimulationReplaced?.Invoke();
            return new FileResult(true, $"Loaded {summary.CityName} from {Path.GetFileName(path)} ({watch.ElapsedMilliseconds} ms).");
        }
        catch (SaveGameException ex)
        {
            return new FileResult(false, ex.Message);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return new FileResult(false, $"Could not open the save: {ex.Message}");
        }
    }

    public void Dispose() => Runner.Dispose();

    private void Bind(NewGameSettings settings, Simulation sim, AutoMayor? mayor)
    {
        LastSettings = settings;
        CityName = settings.DemoCity ? "Demo City" : DefaultCityName;
        _mayor = mayor is null ? null : new MayorBinding(sim, mayor);
        _autoMayorEnabled = settings.AutoMayor;
    }

    /// <summary>Runs on the simulation thread with the state lock held.</summary>
    private void OnHour(Simulation sim)
    {
        if (_autoMayorEnabled && _mayor is { } binding && ReferenceEquals(binding.Simulation, sim))
        {
            binding.Mayor.Manage();
        }
    }

    private sealed record MayorBinding(Simulation Simulation, AutoMayor Mayor);
}
