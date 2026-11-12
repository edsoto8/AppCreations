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
    }

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
