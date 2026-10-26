using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using MetroSim.App.Controls;
using MetroSim.App.Rendering;
using MetroSim.App.Tools;
using MetroSim.App.ViewModels;
using MetroSim.Core.Engine;

namespace MetroSim.App.Views;

/// <summary>
/// Main window. Owns the keyboard shortcuts (handled on the tunnelling pass so they work whatever has
/// focus, except while typing in a text box) and forwards camera keys to the map.
/// </summary>
public sealed partial class MainWindow : Window
{
    /// <summary>Required by the XAML loader; the app always passes a view model.</summary>
    public MainWindow()
    {
        InitializeComponent();
    }

    public MainWindow(MainViewModel viewModel)
        : this()
    {
        DataContext = viewModel;
        viewModel.AttachRenderStats(() => Map.Renderer.Stats);
        AddHandler(KeyDownEvent, OnKeyDownTunnel, RoutingStrategies.Tunnel);
        AddHandler(KeyUpEvent, OnKeyUpTunnel, RoutingStrategies.Tunnel);
        Opened += (_, _) =>
        {
            viewModel.StartTimer();
            Map.Focus();
        };
        Deactivated += (_, _) => Map.ReleaseKeys();
    }

    public MapView Map => MapControl;

    public MainViewModel ViewModel => (MainViewModel)DataContext!;

    /// <summary>Applies a shortcut. Public so tests can drive the same path as real key presses.</summary>
    public bool HandleShortcut(Key key, KeyModifiers modifiers)
    {
        var vm = ViewModel;
        bool ctrl = modifiers.HasFlag(KeyModifiers.Control) || modifiers.HasFlag(KeyModifiers.Meta);
        bool shift = modifiers.HasFlag(KeyModifiers.Shift);

        if (ctrl)
        {
            switch (key)
            {
                case Key.S when shift:
                    vm.SaveAsCommand.Execute(null);
                    return true;
                case Key.S:
                    vm.SaveCommand.Execute(null);
                    return true;
                case Key.O:
                    vm.LoadCommand.Execute(null);
                    return true;
                case Key.N:
                    vm.NewGame.Open();
                    return true;
                case Key.D1 or Key.D2 or Key.D3 or Key.D4:
                    vm.Speed = (SimulationSpeed)(key - Key.D1 + 1);
                    return true;
                default:
                    return false;
            }
        }

        if (shift && key is >= Key.D0 and <= Key.D9)
        {
            // Shift+1..9 = overlays 1..9, Shift+0 = overlay 10 (health).
            int index = key == Key.D0 ? 10 : key - Key.D0;
            vm.ToggleOverlay((OverlayKind)index);
            return true;
        }

        switch (key)
        {
            case Key.Space:
                vm.TogglePause();
                return true;
            case Key.F5:
                vm.QuickSave();
                return true;
            case Key.F9:
                vm.QuickLoad();
                return true;
            case Key.F1:
                vm.ShowPanel(PanelKind.Help);
                return true;
            case Key.F2:
                vm.ShowPanel(PanelKind.Finance);
                return true;
            case Key.F3:
                vm.ShowPanel(PanelKind.City);
                return true;
            case Key.F4:
                vm.ShowPanel(PanelKind.Traffic);
                return true;
            case Key.F6:
                vm.ShowPanel(PanelKind.Performance);
                return true;
            case Key.F7:
                vm.ShowPanel(PanelKind.Events);
                return true;
            case Key.F8:
                vm.ShowPanel(PanelKind.Inspector);
                return true;
            case Key.OemTilde:
                vm.SelectedOverlay = OverlayInfo.Of(OverlayKind.None);
                return true;
            case Key.Escape:
                if (Map.HandleKeyDown(key))
                {
                    return true;
                }

                if (vm.NewGame.IsOpen)
                {
                    vm.NewGame.Cancel();
                }
                else
                {
                    vm.SelectTool(ToolKind.Select);
                }

                return true;
        }

        if (modifiers == KeyModifiers.None && Map.HandleKeyDown(key))
        {
            return true;
        }

        if (modifiers == KeyModifiers.None && ToolCatalog.ForKey(key) is { } tool)
        {
            vm.SelectTool(tool.Kind);
            return true;
        }

        return false;
    }

    private void OnKeyDownTunnel(object? sender, KeyEventArgs e)
    {
        // Let text boxes (the seed field) and the new-game dialog keep their keys.
        if (e.Source is TextBox || (ViewModel.NewGame.IsOpen && e.Key != Key.Escape))
        {
            return;
        }

        if (HandleShortcut(e.Key, e.KeyModifiers))
        {
            e.Handled = true;
        }
    }

    private void OnKeyUpTunnel(object? sender, KeyEventArgs e) => Map.HandleKeyUp(e.Key);
}
