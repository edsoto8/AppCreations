using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using BoardFlow.App.ViewModels;

namespace BoardFlow.App.Views;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        PanelBackdrop.PointerPressed += async (_, e) =>
        {
            if (DataContext is MainViewModel vm)
            {
                e.Handled = true;
                await vm.Panels.CloseAsync();
            }
        };
        AddHandler(KeyDownEvent, OnKeyDownTunnel, RoutingStrategies.Tunnel);
    }

    private MainViewModel? ViewModel => DataContext as MainViewModel;

    /// <summary>Shortcuts that must work even while a text box has focus.</summary>
    private void OnKeyDownTunnel(object? sender, KeyEventArgs e)
    {
        if (ViewModel is not { } vm)
        {
            return;
        }

        var command = e.KeyModifiers is KeyModifiers.Control or KeyModifiers.Meta;
        if (command && e.Key == Key.F && vm.Dialogs.Current is null && vm.CurrentBoard is not null)
        {
            SearchBox.Focus(NavigationMethod.Tab);
            SearchBox.SelectAll();
            e.Handled = true;
        }
        else if (vm.Dialogs.Current is { } dialog && e.KeyModifiers == KeyModifiers.None)
        {
            // While a dialog is open it owns Enter and Escape (except Enter in a multi-line box).
            if (e.Key == Key.Escape)
            {
                dialog.Cancel();
                e.Handled = true;
            }
            else if (e.Key == Key.Enter && e.Source is not TextBox { AcceptsReturn: true })
            {
                dialog.ConfirmCommand.Execute(null);
                e.Handled = true;
            }
        }
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
