using TaskFlow.Services;

namespace TaskFlow;

/// <summary>
/// The composition root: the one place that creates the app's services and view models and wires them together.
/// It is plain constructor injection done by hand. A DI container would do the same thing for a bigger app.
/// </summary>
public sealed class AppServices
{
    public AppServices(Frame rootFrame)
    {
        Time = TimeProvider.System;
        Tasks = new TaskService(Time);
        Navigation = new FrameNavigationService(rootFrame);
        Dialogs = new ContentDialogService(() => rootFrame.XamlRoot);
        MainViewModel = new MainViewModel(Tasks, Navigation, Dialogs, Time);
    }

    public TimeProvider Time { get; }

    public TaskService Tasks { get; }

    public INavigationService Navigation { get; }

    public IDialogService Dialogs { get; }

    /// <summary>One instance for the app's lifetime, so the main list keeps its filter and sort.</summary>
    public MainViewModel MainViewModel { get; }

    /// <summary>A fresh editor view model each time the editor opens.</summary>
    public EditTaskViewModel CreateEditTaskViewModel(Guid? taskId) => new(Tasks, Navigation, taskId);

    /// <summary>Milestone 3/4: start with a few in-memory sample tasks. Milestone 5 loads them from disk instead.</summary>
    public async Task AddSampleTasksAsync()
    {
        var today = DateOnly.FromDateTime(DateTime.Today);
        await Tasks.AddAsync(new TaskDraft("Read the Uno Platform docs", "Start with 'How Uno works'.", today, Priority.High));
        await Tasks.AddAsync(new TaskDraft("Build the TaskFlow main page", "Grid, StackPanel and ListView.", today.AddDays(2), Priority.Medium));
        await Tasks.AddAsync(new TaskDraft("Buy groceries", "", null, Priority.Low));
    }
}
