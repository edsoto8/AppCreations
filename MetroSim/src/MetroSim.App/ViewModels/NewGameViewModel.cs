using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MetroSim.App.Game;

namespace MetroSim.App.ViewModels;

/// <summary>The new-game panel: seed, map size and starting options.</summary>
public sealed partial class NewGameViewModel : ObservableObject
{
    private readonly MainViewModel _main;

    [ObservableProperty]
    private bool _isOpen;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(SeedError))]
    [NotifyCanExecuteChangedFor(nameof(StartCommand))]
    private string _seedText = "";

    [ObservableProperty]
    private int _mapSize = 128;

    [ObservableProperty]
    private bool _demoCity;

    [ObservableProperty]
    private bool _autoMayor = true;

    public NewGameViewModel(MainViewModel main) => _main = main;

    public IReadOnlyList<int> MapSizes { get; } = NewGameSettings.MapSizes;

    public string? SeedError => TryParseSeed(out _) ? null : "Enter a whole number (0 to 18446744073709551615).";

    [RelayCommand]
    public void Open()
    {
        var last = _main.Session.LastSettings;
        SeedText = NewGameSettings.RandomSeed().ToString(CultureInfo.InvariantCulture);
        MapSize = last?.MapSize ?? 128;
        DemoCity = last?.DemoCity ?? false;
        IsOpen = true;
    }

    [RelayCommand]
    public void Cancel() => IsOpen = false;

    [RelayCommand]
    public void RandomSeed() => SeedText = NewGameSettings.RandomSeed().ToString(CultureInfo.InvariantCulture);

    [RelayCommand(CanExecute = nameof(CanStart))]
    public void Start()
    {
        if (!TryParseSeed(out ulong seed))
        {
            return;
        }

        IsOpen = false;
        _main.StartNewGame(new NewGameSettings(seed, MapSize, DemoCity, DemoCity && AutoMayor));
    }

    private bool CanStart() => TryParseSeed(out _);

    private bool TryParseSeed(out ulong seed) =>
        ulong.TryParse(SeedText.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out seed);
}
