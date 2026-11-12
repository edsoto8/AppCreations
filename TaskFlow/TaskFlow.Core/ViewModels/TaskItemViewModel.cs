using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using TaskFlow.Core.Models;

namespace TaskFlow.Core.ViewModels;

/// <summary>
/// What one row of the task list shows. It wraps a <see cref="TaskItem"/> (the model) and adds display-ready values
/// (texts, flags) plus the commands for that row. The list's DataTemplate binds to this class.
/// </summary>
public sealed partial class TaskItemViewModel : ObservableObject
{
    private readonly MainViewModel _owner;

    public TaskItemViewModel(TaskItem model, MainViewModel owner)
    {
        Model = model;
        _owner = owner;
    }

    public TaskItem Model { get; }

    public Guid Id => Model.Id;

    public string Title => Model.Title;

    public string Description => Model.Description;

    public bool HasDescription => Model.Description.Length > 0;

    public Priority Priority => Model.Priority;

    public string PriorityLabel => $"{Model.Priority} priority";

    public bool IsCompleted => Model.IsCompleted;

    public bool HasDueDate => Model.DueDate is not null;

    /// <summary>True when the task is still open and its due date is before today.</summary>
    public bool IsOverdue => !Model.IsCompleted && Model.DueDate < _owner.Today;

    /// <summary>True when there is a due date and it is not overdue (the page shows overdue dates differently).</summary>
    public bool ShowRegularDueDate => HasDueDate && !IsOverdue;

    public string DueDateText => FormatDueDate(Model.DueDate, _owner.Today);

    /// <summary>"Overdue · Nov 10" (or "Overdue · yesterday"); empty when not overdue.</summary>
    public string OverdueText => IsOverdue ? FormatOverdue(Model.DueDate!.Value, _owner.Today) : string.Empty;

    /// <summary>Called by the owner after the model changed, so every bound value is read again.</summary>
    public void Refresh() => OnPropertyChanged(string.Empty); // string.Empty = "all properties changed"

    [RelayCommand]
    private Task ToggleCompletedAsync() => _owner.SetCompletedAsync(this, !Model.IsCompleted);

    [RelayCommand]
    private void Edit() => _owner.EditTask(this);

    [RelayCommand]
    private Task DeleteAsync() => _owner.DeleteTaskAsync(this);

    internal static string FormatOverdue(DateOnly due, DateOnly today) =>
        due.DayNumber == today.DayNumber - 1
            ? "Overdue · yesterday"
            : $"Overdue · {due.ToString(due.Year == today.Year ? "MMM d" : "MMM d, yyyy", CultureInfo.CurrentCulture)}";

    internal static string FormatDueDate(DateOnly? due, DateOnly today)
    {
        if (due is not { } date)
        {
            return string.Empty;
        }

        var days = date.DayNumber - today.DayNumber;
        var format = date.Year == today.Year ? "MMM d" : "MMM d, yyyy";
        var text = date.ToString(format, CultureInfo.CurrentCulture);
        return days switch
        {
            0 => "Due today",
            1 => "Due tomorrow",
            -1 => "Due yesterday",
            _ => $"Due {text}",
        };
    }
}
