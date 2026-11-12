using TaskFlow.Core.Models;
using TaskFlow.Core.Services;
using TaskFlow.Core.ViewModels;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public class EditTaskViewModelTests
{
    private readonly FakeNavigation _navigation = new();
    private readonly TaskService _service = Services.LoadedTaskService();

    private EditTaskViewModel Editor(Guid? id = null) => new(_service, _navigation, id);

    [Fact]
    public void NewTask_HasDefaults()
    {
        var vm = Editor();
        Assert.True(vm.IsNew);
        Assert.Equal("New task", vm.PageTitle);
        Assert.Equal(Priority.Medium, vm.SelectedPriority.Value);
        Assert.Null(vm.DueDate);
        Assert.False(vm.HasTitleError);
    }

    [Fact]
    public async Task Save_NewTask_AddsAndGoesBack()
    {
        var vm = Editor();
        vm.Title = "  Write tests  ";
        vm.Description = "xUnit";
        vm.DueDate = new DateTimeOffset(2026, 4, 1, 0, 0, 0, TimeSpan.Zero);
        vm.SelectedPriority = vm.PriorityChoices.Single(c => c.Value == Priority.High);

        await vm.SaveCommand.ExecuteAsync(null);

        var saved = Assert.Single(_service.Tasks);
        Assert.Equal("Write tests", saved.Title); // trimmed
        Assert.Equal("xUnit", saved.Description);
        Assert.Equal(new DateOnly(2026, 4, 1), saved.DueDate);
        Assert.Equal(Priority.High, saved.Priority);
        Assert.Equal(1, _navigation.BackCount);
    }

    [Fact]
    public async Task Save_EmptyTitle_ShowsErrorAndStays()
    {
        var vm = Editor();
        vm.Title = "   ";

        await vm.SaveCommand.ExecuteAsync(null);

        Assert.True(vm.HasTitleError);
        Assert.Empty(_service.Tasks);
        Assert.Equal(0, _navigation.BackCount);
    }

    [Fact]
    public async Task TitleError_ClearsLiveAfterFirstSaveAttempt()
    {
        var vm = Editor();
        await vm.SaveCommand.ExecuteAsync(null);
        Assert.True(vm.HasTitleError);

        vm.Title = "Fixed";
        Assert.False(vm.HasTitleError);
    }

    [Fact]
    public void TitleError_NotShownBeforeFirstSave()
    {
        var vm = Editor();
        vm.Title = "x";
        vm.Title = "";
        Assert.False(vm.HasTitleError);
    }

    [Fact]
    public async Task EditExisting_LoadsFieldsAndUpdates()
    {
        var task = await _service.AddAsync(Draft("Old", Priority.Low, Today, "desc"));
        var vm = Editor(task.Id);

        Assert.False(vm.IsNew);
        Assert.Equal("Edit task", vm.PageTitle);
        Assert.Equal("Old", vm.Title);
        Assert.Equal("desc", vm.Description);
        Assert.Equal(Priority.Low, vm.SelectedPriority.Value);
        Assert.Equal(Today, DateOnly.FromDateTime(vm.DueDate!.Value.Date));

        vm.Title = "New";
        vm.ClearDueDateCommand.Execute(null);
        await vm.SaveCommand.ExecuteAsync(null);

        var saved = Assert.Single(_service.Tasks);
        Assert.Same(task, saved);
        Assert.Equal("New", saved.Title);
        Assert.Null(saved.DueDate);
    }

    [Fact]
    public async Task Cancel_DiscardsChanges()
    {
        var task = await _service.AddAsync(Draft("Keep me"));
        var vm = Editor(task.Id);
        vm.Title = "Changed";

        vm.CancelCommand.Execute(null);

        Assert.Equal("Keep me", task.Title);
        Assert.Equal(1, _navigation.BackCount);
    }

    [Fact]
    public async Task EditingDeletedTask_ShowsErrorAndCannotSave()
    {
        var vm = Editor(Guid.NewGuid());
        Assert.True(vm.IsMissing);
        Assert.True(vm.HasError);

        vm.Title = "Anything";
        await vm.SaveCommand.ExecuteAsync(null);
        Assert.Empty(_service.Tasks);
    }
}
