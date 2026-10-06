using System.ComponentModel;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using BoardFlow.App.ViewModels;

namespace BoardFlow.App.Views;

public sealed partial class MainWindow : Window
{
    private readonly DispatcherTimer _dateTimer = new() { Interval = TimeSpan.FromMinutes(1) };
    private MainViewModel? _subscribed;
    private IInputElement? _focusBeforeOverlay;

    public MainWindow()
    {
        InitializeComponent();
        PanelBackdrop.PointerPressed += async (_, e) =>
        {
            if (ViewModel is { } vm)
            {
                e.Handled = true;
                await vm.Panels.CloseAsync();
            }
        };
        AddHandler(KeyDownEvent, OnKeyDownTunnel, RoutingStrategies.Tunnel);
        DataContextChanged += (_, _) => Subscribe(ViewModel);
        _dateTimer.Tick += (_, _) => ViewModel?.CheckDateRollover();
        Opened += (_, _) => _dateTimer.Start();
        Closed += (_, _) =>
        {
            _dateTimer.Stop();
            Subscribe(null);
        };
    }

    private MainViewModel? ViewModel => DataContext as MainViewModel;

    /// <summary>The overlay that currently owns the keyboard: the dialog, else the side panel, else none.</summary>
    private Control? ActiveLayer =>
        ViewModel?.Dialogs.Current is not null ? DialogCard
        : ViewModel?.Panels.Current is not null ? PanelCard
        : null;

    private void Subscribe(MainViewModel? vm)
    {
        if (_subscribed is not null)
        {
            _subscribed.Dialogs.PropertyChanged -= OnOverlayChanged;
            _subscribed.Panels.PropertyChanged -= OnOverlayChanged;
        }

        _subscribed = vm;
        if (vm is not null)
        {
            vm.Dialogs.PropertyChanged += OnOverlayChanged;
            vm.Panels.PropertyChanged += OnOverlayChanged;
        }
    }

    /// <summary>
    /// When a dialog or panel opens, focus moves into it (remembering where it was); when the last one
    /// closes, focus goes back. Destructive dialogs start on Cancel so a stray Enter is harmless.
    /// </summary>
    private void OnOverlayChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (ViewModel is not { } vm)
        {
            return;
        }

        var layer = ActiveLayer;
        if (layer is null)
        {
            var restore = _focusBeforeOverlay;
            _focusBeforeOverlay = null;
            Dispatcher.UIThread.Post(() => restore?.Focus(), DispatcherPriority.Loaded);
            return;
        }

        var focused = FocusManager?.GetFocusedElement();
        if (_focusBeforeOverlay is null && focused is Visual v && !IsInOverlay(v))
        {
            _focusBeforeOverlay = focused;
        }

        Dispatcher.UIThread.Post(() =>
        {
            if (FocusManager?.GetFocusedElement() is Visual current && current.GetSelfAndVisualAncestors().Contains(layer))
            {
                return; // e.g. a text box focused itself via FocusBehavior
            }

            Control? target = layer == DialogCard
                ? (vm.Dialogs.Current is { IsDestructive: true, ShowCancel: true } ? DialogCancel : DialogConfirm)
                : FocusableIn(layer).FirstOrDefault() as Control;
            target?.Focus(NavigationMethod.Tab);
        }, DispatcherPriority.Loaded);
    }

    private bool IsInOverlay(Visual visual) =>
        visual.GetSelfAndVisualAncestors().Any(a => a == DialogCard || a == PanelCard);

    private static List<InputElement> FocusableIn(Control layer) =>
        layer.GetVisualDescendants().OfType<InputElement>()
            .Where(e => e.Focusable && e.IsTabStop && e.IsEffectivelyEnabled && e.IsEffectivelyVisible)
            .ToList();

    /// <summary>Shortcuts and overlay keyboard rules that must apply even while a text box has focus.</summary>
    private void OnKeyDownTunnel(object? sender, KeyEventArgs e)
    {
        if (ViewModel is not { } vm)
        {
            return;
        }

        var command = e.KeyModifiers is KeyModifiers.Control or KeyModifiers.Meta;
        if (e.Key == Key.Tab && ActiveLayer is { } layer)
        {
            // Keep Tab inside the dialog or panel instead of wandering onto the board behind it.
            TrapTab(layer, backwards: e.KeyModifiers.HasFlag(KeyModifiers.Shift));
            e.Handled = true;
        }
        else if (command && e.Key == Key.F && ActiveLayer is null && vm.CurrentBoard is not null)
        {
            SearchBox.Focus(NavigationMethod.Tab);
            SearchBox.SelectAll();
            e.Handled = true;
        }
        else if (vm.Dialogs.Current is { } dialog && e.KeyModifiers == KeyModifiers.None)
        {
            if (e.Key == Key.Escape)
            {
                dialog.Cancel();
                e.Handled = true;
            }
            else if (e.Key == Key.Enter && e.Source is TextBox { AcceptsReturn: false })
            {
                // Enter in a single-line field confirms. On a focused button, Enter presses that button.
                dialog.ConfirmCommand.Execute(null);
                e.Handled = true;
            }
        }
    }

    private void TrapTab(Control layer, bool backwards)
    {
        var items = FocusableIn(layer);
        if (items.Count == 0)
        {
            return;
        }

        var current = FocusManager?.GetFocusedElement() as Visual;
        var index = items.FindIndex(i => current is not null && current.GetSelfAndVisualAncestors().Contains(i));
        var next = index < 0
            ? (backwards ? items.Count - 1 : 0)
            : (index + (backwards ? -1 : 1) + items.Count) % items.Count;
        items[next].Focus(NavigationMethod.Tab);
    }

    /// <summary>Escape closes the side panel or clears the search, unless a focused control used it already.</summary>
    protected override async void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Handled || e.Key != Key.Escape || ViewModel is not { } vm)
        {
            return;
        }

        e.Handled = true;
        if (await vm.CloseTopmostAsync())
        {
            return;
        }

        if (e.Source == SearchBox && vm.CurrentBoard is { } board)
        {
            board.SearchText = "";
            BoardView.Focus();
        }
    }
}
