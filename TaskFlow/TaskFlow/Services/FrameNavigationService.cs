using TaskFlow.Views;

namespace TaskFlow.Services;

/// <summary>Navigation with the plain WinUI <see cref="Frame"/>: each call pushes or pops a page.</summary>
public sealed class FrameNavigationService(Frame frame) : INavigationService
{
    // The parameter travels to EditTaskPage.OnNavigatedTo as e.Parameter.
    public void OpenTaskEditor(Guid? taskId) => frame.Navigate(typeof(EditTaskPage), taskId);

    public void GoBack()
    {
        if (frame.CanGoBack)
        {
            frame.GoBack();
        }
    }
}
