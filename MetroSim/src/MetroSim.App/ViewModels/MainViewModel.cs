using System.Collections.ObjectModel;
using Avalonia.Media;
using Avalonia.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MetroSim.App.Controls;
using MetroSim.App.Game;
using MetroSim.App.Rendering;
using MetroSim.App.Services;
using MetroSim.App.Tools;
using MetroSim.Core.Engine;

namespace MetroSim.App.ViewModels;

public enum PanelKind
{
    Inspector = 0,
    Finance = 1,
    City = 2,
    Traffic = 3,
    Performance = 4,
    Events = 5,
    Help = 6,
}

/// <summary>
/// The main window's state: tools, overlays, speed, top-bar numbers, dashboards and file commands.
/// <see cref="Refresh"/> (4 times a second) takes the state lock once, lets every panel copy what it
/// needs, then publishes the copies to bindings after releasing the lock.
/// </summary>
public sealed partial class MainViewModel : ObservableObject, IMapHost, IDisposable
{
    public static readonly IBrush PositiveBrush = new SolidColorBrush(Color.FromRgb(0x6C, 0xE0, 0x8C));
    public static readonly IBrush NegativeBrush = new SolidColorBrush(Color.FromRgb(0xF0, 0x6A, 0x5A));

    private readonly IFileDialogs _dialogs;
    private readonly DispatcherTimer _timer;
    private SimulationSpeed _resumeSpeed = SimulationSpeed.Normal;
    private long _eventsSeen = -1;
    private EventItem[] _capturedEvents = [];
    private long _capturedMoney;
    private long? _capturedNet;
    private int _capturedPopulation;
    private int _capturedJobs;
    private long _capturedTick;
    private (int R, int C, int I) _capturedDemand;
    private Func<RenderStats?> _renderStats = () => null;

    [ObservableProperty]
    private ToolDefinition _activeTool = ToolCatalog.Get(ToolKind.Select);

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Overlay), nameof(Legend), nameof(HasLegend))]
    private OverlayInfo _selectedOverlay = OverlayInfo.Of(OverlayKind.None);

    [ObservableProperty]
    private SimulationSpeed _speed;

    [ObservableProperty]
    private MapSelection _selection = MapSelection.None;

    [ObservableProperty]
    private int _selectedPanel = (int)PanelKind.City;

    [ObservableProperty]
    private string _cityName = "";

    [ObservableProperty]
    private string _moneyText = "";

    [ObservableProperty]
    private IBrush _moneyBrush = Brushes.White;

    [ObservableProperty]
    private string _netText = "";

    [ObservableProperty]
    private IBrush _netBrush = Brushes.White;

    [ObservableProperty]
    private string _populationText = "";

    [ObservableProperty]
    private string _jobsText = "";

    [ObservableProperty]
    private string _dateText = "";

    [ObservableProperty]
    private int _demandResidential;

    [ObservableProperty]
    private int _demandCommercial;

    [ObservableProperty]
    private int _demandIndustrial;

    [ObservableProperty]
    private string _statusText = "Welcome to MetroSim. Build roads (1), zone land (5-7) and add power (C) and water (P).";

    [ObservableProperty]
    private bool _statusIsError;

    [ObservableProperty]
    private string _hoverText = "";

    [ObservableProperty]
    private string _toolHint = "";

    [ObservableProperty]
    private string _speedText = "";

    [ObservableProperty]
    private bool _autoMayorAvailable;

    [ObservableProperty]
    private bool _autoMayorEnabled;

    public MainViewModel(GameSession session, IFileDialogs dialogs)
    {
        Session = session;
        _dialogs = dialogs;
        Finance = new FinanceViewModel(this);
        City = new CityViewModel();
        Traffic = new TrafficViewModel();
        Performance = new PerformanceViewModel(() => _renderStats());
        Inspector = new InspectorViewModel();
        NewGame = new NewGameViewModel(this);

        var items = ToolCatalog.All.Select(t => new ToolItemViewModel(t)).ToList();
        ToolGroups = items.GroupBy(i => i.Definition.Group).Select(g => new ToolGroup(g.Key, g.ToList())).ToList();
        ToolItems = items;
        Speeds =
        [
            new SpeedOption("❚❚", SimulationSpeed.Paused, "Pause (Space)"),
            new SpeedOption("1x", SimulationSpeed.Normal, "Normal speed: 12 minutes per second (Ctrl+1)"),
            new SpeedOption("2x", SimulationSpeed.Fast, "Fast: 48 minutes per second (Ctrl+2)"),
            new SpeedOption("3x", SimulationSpeed.Faster, "Faster: 192 minutes per second (Ctrl+3)"),
            new SpeedOption("Max", SimulationSpeed.Unlimited, "As fast as the CPU allows (Ctrl+4)"),
        ];

        _speed = session.Runner.Speed;
        Session.SimulationReplaced += OnSimulationReplaced;
        _timer = new DispatcherTimer(TimeSpan.FromMilliseconds(250), DispatcherPriority.Background, (_, _) => TimerRefresh());
        UpdateToolItems();
        UpdateSpeedOptions();
        Refresh();
    }

    public GameSession Session { get; }

    public FinanceViewModel Finance { get; }

    public CityViewModel City { get; }

    public TrafficViewModel Traffic { get; }

    public PerformanceViewModel Performance { get; }

    public InspectorViewModel Inspector { get; }

    public NewGameViewModel NewGame { get; }

    public IReadOnlyList<ToolGroup> ToolGroups { get; }

    public IReadOnlyList<ToolItemViewModel> ToolItems { get; }

    public IReadOnlyList<OverlayInfo> Overlays => OverlayInfo.All;

    public IReadOnlyList<SpeedOption> Speeds { get; }

    public ObservableCollection<EventItem> Events { get; } = [];

    public OverlayKind Overlay => SelectedOverlay.Kind;

    public bool HasLegend => SelectedOverlay.Kind != OverlayKind.None;

    public IReadOnlyList<LegendItem> Legend => SelectedOverlay.Legend.Select(LegendItem.From).ToList();

    public event Action<int, int>? CenterRequested;

    /// <summary>Lets the performance panel read the map's render counters.</summary>
    public void AttachRenderStats(Func<RenderStats?> stats) => _renderStats = stats;

    public void StartTimer() => _timer.Start();

    public void Dispose()
    {
        _timer.Stop();
        Session.SimulationReplaced -= OnSimulationReplaced;
    }

    // ---------------------------------------------------------------- refresh

    /// <summary>Copies dashboard data under one short state lock, then updates bindings.</summary>
    public void Refresh() => Refresh(Timeout.InfiniteTimeSpan);

    /// <summary>Timer refresh: skipped (retried next tick) if the simulation holds the lock too long.</summary>
    private void TimerRefresh() => Refresh(TimeSpan.FromMilliseconds(25));

    private void Refresh(TimeSpan lockTimeout)
    {
        var runner = Session.Runner;
        bool locked = false;
        try
        {
            Monitor.TryEnter(runner.StateLock, lockTimeout, ref locked);
            if (!locked)
            {
                return;
            }

            var sim = runner.Simulation;
            _capturedTick = sim.Tick;
            _capturedMoney = sim.Budget.Money;
            _capturedNet = sim.Budget.History.Count > 0 ? sim.Budget.History[^1].Net : null;
            _capturedPopulation = sim.Stats.Population;
            _capturedJobs = sim.Stats.Jobs;
            _capturedDemand = (sim.Demand.Residential, sim.Demand.Commercial, sim.Demand.Industrial);
            if (sim.Events.TotalCount != _eventsSeen)
            {
                _eventsSeen = sim.Events.TotalCount;
                _capturedEvents = sim.Events.Items.Reverse()
                    .Select(e => new EventItem(Format.Date(e.Tick), e.Message, e.Severity, e.Tile))
                    .ToArray();
            }
            else
            {
                _capturedEvents = [];
            }

            Finance.Capture(sim);
            City.Capture(sim);
            Traffic.Capture(sim);
            Performance.Capture(sim);
            Inspector.Capture(sim, Selection);
        }
        finally
        {
            if (locked)
            {
                Monitor.Exit(runner.StateLock);
            }
        }

        Performance.SetTicksPerSecond(runner.MeasuredTicksPerSecond);
        Publish();
    }

    private void Publish()
    {
        CityName = Session.CityName;
        MoneyText = Format.Money(_capturedMoney);
        MoneyBrush = _capturedMoney < 0 ? NegativeBrush : Brushes.White;
        NetText = _capturedNet is { } net ? Format.SignedMoney(net) + "/day" : "first day";
        NetBrush = _capturedNet is null ? Brushes.Gray : _capturedNet >= 0 ? PositiveBrush : NegativeBrush;
        PopulationText = Format.Number(_capturedPopulation);
        JobsText = Format.Number(_capturedJobs);
        DateText = Format.Date(_capturedTick);
        DemandResidential = _capturedDemand.R;
        DemandCommercial = _capturedDemand.C;
        DemandIndustrial = _capturedDemand.I;
        double tps = Session.Runner.MeasuredTicksPerSecond;
        SpeedText = Speed == SimulationSpeed.Paused ? "paused" : $"{Format.Fixed(tps, 0)} min/s";
        AutoMayorAvailable = Session.AutoMayorAvailable;
        AutoMayorEnabled = Session.AutoMayorEnabled;
        if (_capturedEvents.Length > 0)
        {
            Events.Clear();
            foreach (var e in _capturedEvents)
            {
                Events.Add(e);
            }
        }

        Finance.Publish();
        City.Publish();
        Traffic.Publish();
        Performance.Publish();
        Inspector.Publish(Selection);
    }

    // ---------------------------------------------------------------- tools, overlays, speed

    [RelayCommand]
    public void SelectTool(ToolKind kind) => ActiveTool = ToolCatalog.Get(kind);

    partial void OnActiveToolChanged(ToolDefinition value)
    {
        UpdateToolItems();
        ToolHint = value.Description;
    }

    private void UpdateToolItems()
    {
        foreach (var item in ToolItems)
        {
            item.IsActive = item.Kind == ActiveTool.Kind;
        }

        ToolHint = ActiveTool.Description;
    }

    /// <summary>Hotkey behaviour: pressing the active overlay's key again turns it off.</summary>
    [RelayCommand]
    public void ToggleOverlay(OverlayKind kind) =>
        SelectedOverlay = OverlayInfo.Of(SelectedOverlay.Kind == kind ? OverlayKind.None : kind);

    [RelayCommand]
    public void SetSpeed(SimulationSpeed speed) => Speed = speed;

    [RelayCommand]
    public void TogglePause() => Speed = Speed == SimulationSpeed.Paused ? _resumeSpeed : SimulationSpeed.Paused;

    partial void OnSpeedChanged(SimulationSpeed value)
    {
        if (value != SimulationSpeed.Paused)
        {
            _resumeSpeed = value;
        }

        Session.Runner.Speed = value;
        UpdateSpeedOptions();
        SpeedText = value == SimulationSpeed.Paused ? "paused" : SpeedText;
    }

    private void UpdateSpeedOptions()
    {
        foreach (var option in Speeds)
        {
            option.IsActive = option.Speed == Speed;
        }
    }

    partial void OnAutoMayorEnabledChanged(bool value) => Session.AutoMayorEnabled = value;

    [RelayCommand]
    public void ShowPanel(PanelKind panel) => SelectedPanel = (int)panel;

    // ---------------------------------------------------------------- map host

    public void Select(MapSelection selection)
    {
        Selection = selection;
        if (selection.Kind != SelectionKind.None)
        {
            SelectedPanel = (int)PanelKind.Inspector;
        }

        RefreshInspector();
    }

    public void OnCommandApplied(ToolDefinition tool, CommandResult result)
    {
        if (result.Success)
        {
            string cost = result.Cost > 0 ? $" Cost {Format.Money(result.Cost)}." : "";
            ShowStatus(result.Message + cost, false);
        }
        else
        {
            ShowStatus($"{tool.Name}: {result.Message}", true);
        }

        Refresh();
    }

    public void OnHover(int x, int y) => HoverText = x < 0 ? "" : $"Tile ({x}, {y})";

    public void ShowStatus(string message, bool error)
    {
        StatusText = message;
        StatusIsError = error;
    }

    [RelayCommand]
    public void CenterOnEvent(EventItem item)
    {
        if (item.Tile < 0)
        {
            return;
        }

        int width;
        lock (Session.Runner.StateLock)
        {
            width = Session.Runner.Simulation.Map.Width;
        }

        CenterRequested?.Invoke(item.Tile % width, item.Tile / width);
    }

    private void RefreshInspector()
    {
        lock (Session.Runner.StateLock)
        {
            Inspector.Capture(Session.Runner.Simulation, Selection);
        }

        Inspector.Publish(Selection);
    }

    // ---------------------------------------------------------------- game and files

    public void StartNewGame(NewGameSettings settings)
    {
        Session.NewGame(settings);
        ShowStatus($"New {settings.MapSize}x{settings.MapSize} map, seed {settings.Seed}{(settings.DemoCity ? ", demo city" : "")}.", false);
    }

    [RelayCommand]
    public async Task Save()
    {
        if (Session.CurrentPath is { } path)
        {
            Report(Session.Save(path));
            return;
        }

        await SaveAs();
    }

    [RelayCommand]
    public async Task SaveAs()
    {
        string suggested = string.Join("_", Session.CityName.Split(Path.GetInvalidFileNameChars())) + Persistence.SaveGameStore.FileExtension;
        var path = await _dialogs.PickSavePath(suggested, Session.SavesDirectory);
        if (path is null)
        {
            return;
        }

        if (!path.EndsWith(Persistence.SaveGameStore.FileExtension, StringComparison.OrdinalIgnoreCase))
        {
            path += Persistence.SaveGameStore.FileExtension;
        }

        Report(Session.Save(path));
    }

    [RelayCommand]
    public async Task Load()
    {
        var path = await _dialogs.PickOpenPath(Session.SavesDirectory);
        if (path is not null)
        {
            Report(Session.Load(path));
        }
    }

    [RelayCommand]
    public void QuickSave()
    {
        var result = Session.Save(Session.QuickSavePath, remember: false);
        Report(result.Success ? result with { Message = "Quick saved. " + result.Message } : result);
    }

    [RelayCommand]
    public void QuickLoad()
    {
        if (!File.Exists(Session.QuickSavePath))
        {
            ShowStatus("No quick save yet (press F5 to quick save).", true);
            return;
        }

        Report(Session.Load(Session.QuickSavePath, remember: false));
    }

    private void Report(FileResult result)
    {
        ShowStatus(result.Message, !result.Success);
        Refresh();
    }

    private void OnSimulationReplaced()
    {
        Selection = MapSelection.None;
        _eventsSeen = -1;
        Events.Clear();
        Refresh();
    }
}
