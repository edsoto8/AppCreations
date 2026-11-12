namespace TaskFlow.Views;

/// <summary>
/// The main screen. With MVVM the code-behind shrinks to "which view model do I show?";
/// everything else is bindings in MainPage.xaml.
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
    }

    public MainViewModel ViewModel { get; }
}
