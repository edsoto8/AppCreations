using System.Collections.ObjectModel;
using TaskFlow.Core.Models;

namespace TaskFlow;

// Milestone 2 version: everything lives in code-behind and reacts to events.
// Milestone 3 moves this logic into a ViewModel.
public sealed partial class MainPage : Page
{
    private readonly ObservableCollection<TaskItem> _tasks =
    [
        new TaskItem { Title = "Read the Uno Platform docs", Description = "Start with 'How Uno works'.", Priority = Priority.High, IsCompleted = true },
        new TaskItem { Title = "Build the TaskFlow main page", Description = "Grid, StackPanel and ListView.", Priority = Priority.Medium },
        new TaskItem { Title = "Buy groceries", Priority = Priority.Low },
    ];

    public MainPage()
    {
        this.InitializeComponent();
        TaskList.ItemsSource = _tasks;
        UpdateCounter();
    }

    private void AddTaskButton_Click(object sender, RoutedEventArgs e)
    {
        _tasks.Add(new TaskItem { Title = $"New task {_tasks.Count + 1}" });
        UpdateCounter(); // With events we must remember to refresh every dependent piece of UI by hand.
    }

    private void UpdateCounter()
    {
        var completed = _tasks.Count(t => t.IsCompleted);
        CounterText.Text = $"{completed} of {_tasks.Count} completed";
    }
}
