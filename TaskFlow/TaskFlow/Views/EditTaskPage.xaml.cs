using Microsoft.UI.Xaml.Navigation;

namespace TaskFlow.Views;

/// <summary>The Add/Edit Task form. Which task to edit arrives as the navigation parameter.</summary>
public sealed partial class EditTaskPage : Page
{
    public EditTaskPage()
    {
        this.InitializeComponent();
    }

    public EditTaskViewModel ViewModel { get; private set; } = null!;

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);

        // FrameNavigationService passed a Guid (edit) or null (new task).
        ViewModel = App.Services.CreateEditTaskViewModel(e.Parameter as Guid?);

        // ViewModel was replaced after InitializeComponent, so ask x:Bind to re-read everything.
        Bindings.Update();
    }

    private void Page_Loaded(object sender, RoutedEventArgs e)
    {
        // Put the cursor in the title box so the user can start typing right away.
        TitleBox.Focus(FocusState.Programmatic);
    }
}
