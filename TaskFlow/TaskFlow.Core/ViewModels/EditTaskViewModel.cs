using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;
using TaskFlow.Core.Services;

namespace TaskFlow.Core.ViewModels;

/// <summary>
/// The view model behind the Add/Edit Task page. It holds a working copy of the task's fields, so Cancel simply
/// throws the copy away. Save validates, writes through <see cref="TaskService"/> and navigates back.
/// </summary>
public sealed partial class EditTaskViewModel : ObservableObject
{
    private readonly TaskService _tasks;
    private readonly INavigationService _navigation;
    private readonly Guid? _taskId;

    // Errors appear after the first Save attempt, then update live while the user types.
    private bool _showErrors;

    public EditTaskViewModel(TaskService tasks, INavigationService navigation, Guid? taskId)
    {
        _tasks = tasks;
        _navigation = navigation;
        _taskId = taskId;

        SelectedPriority = PriorityChoices.Single(c => c.Value == Priority.Medium);

        if (taskId is { } id)
        {
            if (tasks.Find(id) is { } existing)
            {
                Title = existing.Title;
                Description = existing.Description;
                DueDate = ToDateTimeOffset(existing.DueDate);
                SelectedPriority = PriorityChoices.Single(c => c.Value == existing.Priority);
            }
            else
            {
                IsMissing = true;
                ErrorMessage = "This task no longer exists.";
            }
        }
    }

    public bool IsNew => _taskId is null;

    /// <summary>True when the page was opened for a task that has since been deleted.</summary>
    public bool IsMissing { get; }

    public string PageTitle => IsNew ? "New task" : "Edit task";

    public string SaveButtonText => IsNew ? "Add task" : "Save changes";

    public int MaxTitleLength => TaskValidator.MaxTitleLength;

    public int MaxDescriptionLength => TaskValidator.MaxDescriptionLength;

    public IReadOnlyList<Choice<Priority>> PriorityChoices { get; } =
    [
        new(Priority.Low, "Low"),
        new(Priority.Medium, "Medium"),
        new(Priority.High, "High"),
    ];

    [ObservableProperty]
    public partial string Title { get; set; } = string.Empty;

    [ObservableProperty]
    public partial string Description { get; set; } = string.Empty;

    /// <summary>
    /// The due date as <see cref="DateTimeOffset"/>, because that is what CalendarDatePicker.Date uses.
    /// It is converted to a <see cref="DateOnly"/> when saved.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDueDate))]
    public partial DateTimeOffset? DueDate { get; set; }

    public bool HasDueDate => DueDate is not null;

    [ObservableProperty]
    public partial Choice<Priority> SelectedPriority { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasTitleError))]
    public partial string? TitleError { get; private set; }

    public bool HasTitleError => TitleError is not null;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasDescriptionError))]
    public partial string? DescriptionError { get; private set; }

    public bool HasDescriptionError => DescriptionError is not null;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    public partial string? ErrorMessage { get; private set; }

    public bool HasError => ErrorMessage is not null;

    public TaskDraft ToDraft() =>
        new(Title, Description, DueDate is { } d ? DateOnly.FromDateTime(d.Date) : null, SelectedPriority.Value);

    [RelayCommand]
    private async Task SaveAsync()
    {
        if (IsMissing)
        {
            return;
        }

        _showErrors = true;
        if (!Validate())
        {
            return;
        }

        try
        {
            ErrorMessage = null;
            if (_taskId is { } id)
            {
                await _tasks.UpdateAsync(id, ToDraft());
            }
            else
            {
                await _tasks.AddAsync(ToDraft());
            }

            _navigation.GoBack();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // Stay on the page so nothing the user typed is lost.
            ErrorMessage = ex.Message;
        }
    }

    [RelayCommand]
    private void Cancel() => _navigation.GoBack();

    [RelayCommand]
    private void ClearDueDate() => DueDate = null;

    partial void OnTitleChanged(string value) => ValidateIfShowingErrors();

    partial void OnDescriptionChanged(string value) => ValidateIfShowingErrors();

    private void ValidateIfShowingErrors()
    {
        if (_showErrors)
        {
            Validate();
        }
    }

    private bool Validate()
    {
        var result = TaskValidator.Validate(ToDraft());
        TitleError = result.TitleError;
        DescriptionError = result.DescriptionError;
        return result.IsValid;
    }

    private static DateTimeOffset? ToDateTimeOffset(DateOnly? date) =>
        date is { } d ? new DateTimeOffset(d.ToDateTime(TimeOnly.MinValue)) : null;
}
