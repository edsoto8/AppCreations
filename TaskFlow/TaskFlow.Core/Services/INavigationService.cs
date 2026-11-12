namespace TaskFlow.Core.Services;

/// <summary>
/// What view models may ask of navigation. The app implements it with a XAML Frame; tests use a fake.
/// Keeping Frame out of view models is what makes them testable.
/// </summary>
public interface INavigationService
{
    /// <summary>Opens the task editor. <paramref name="taskId"/> is null for a new task.</summary>
    void OpenTaskEditor(Guid? taskId);

    /// <summary>Returns to the previous page.</summary>
    void GoBack();
}
