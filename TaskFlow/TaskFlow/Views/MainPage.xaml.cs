using TaskFlow.Services;

namespace TaskFlow.Views;

/// <summary>
/// The main screen. With MVVM the code-behind shrinks to "which view model do I show?" plus purely visual
/// behaviour (the theme button). Everything about tasks is bindings in MainPage.xaml.
/// </summary>
public sealed partial class MainPage : Page
{
    public MainPage()
    {
        // Set before InitializeComponent so the first x:Bind pass already sees it.
        ViewModel = App.Services.MainViewModel;
        this.InitializeComponent();

        // Keep this page alive while the editor is open, so going back is instant and keeps the scroll position.
        NavigationCacheMode = NavigationCacheMode.Required;
        UpdateThemeButton();

        // If the app stays open past midnight, "Due today" and overdue flags must move on by themselves.
        _dayTimer.Interval = TimeSpan.FromMinutes(1);
        _dayTimer.Tick += (_, _) => ViewModel.RefreshIfDayChanged();
        _dayTimer.Start();
    }

    // A DispatcherTimer ticks on the UI thread, so it may touch view models and controls directly.
    private readonly DispatcherTimer _dayTimer = new();

    public MainViewModel ViewModel { get; }

    private void ThemeButton_Click(object sender, RoutedEventArgs e)
    {
        App.Services.Theme.Cycle();
        UpdateThemeButton();
    }

    private void UpdateThemeButton()
    {
        var (glyph, label) = App.Services.Theme.Current switch
        {
            AppTheme.Light => ("", "Theme: Light"),   // sun
            AppTheme.Dark => ("", "Theme: Dark"),     // moon
            _ => ("", "Theme: System"),               // half-filled circle
        };
        ThemeIcon.Glyph = glyph;
        ToolTipService.SetToolTip(ThemeButton, $"{label} (click to change)");
        AutomationProperties.SetName(ThemeButton, label);
    }
}
