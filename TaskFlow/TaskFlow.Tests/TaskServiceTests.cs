using TaskFlow.Core.Models;
using TaskFlow.Core.Services;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public class TaskServiceTests
{
    private readonly FakeTaskStore _store = new();
    private readonly TaskService _service;

    public TaskServiceTests()
    {
        _service = Services.LoadedTaskService(_store);
    }

    [Fact]
    public async Task Add_TrimsStampsAndSaves()
    {
        var task = await _service.AddAsync(Draft("  Hello  ", Priority.High, Today, "  details "));

        Assert.Equal("Hello", task.Title);
        Assert.Equal("details", task.Description);
        Assert.Equal(FixedTimeProvider.DefaultNow, task.CreatedAt);
        Assert.False(task.IsCompleted);
        Assert.Equal(task.Id, Assert.Single(_store.Saved).Id);
    }

    [Fact]
    public async Task Add_InvalidDraft_Throws_AndAddsNothing()
    {
        await Assert.ThrowsAsync<ArgumentException>(() => _service.AddAsync(Draft("   ")));
        Assert.Empty(_service.Tasks);
        Assert.Equal(0, _store.SaveCount);
    }

    [Fact]
    public async Task Update_ChangesFieldsAndSaves()
    {
        var task = await _service.AddAsync(Draft("Before"));
        await _service.UpdateAsync(task.Id, Draft("After", Priority.Low, Today, "new"));

        Assert.Equal("After", task.Title);
        Assert.Equal(Priority.Low, task.Priority);
        Assert.Equal(Today, task.DueDate);
        Assert.Equal("new", task.Description);
        Assert.Equal(2, _store.SaveCount);
    }

    [Fact]
    public async Task Update_UnknownId_Throws()
    {
        await Assert.ThrowsAsync<KeyNotFoundException>(() => _service.UpdateAsync(Guid.NewGuid(), Draft("x")));
    }

    [Fact]
    public async Task SetCompleted_SavesOnlyWhenValueChanges()
    {
        var task = await _service.AddAsync(Draft("A"));
        await _service.SetCompletedAsync(task.Id, true);
        await _service.SetCompletedAsync(task.Id, true);

        Assert.True(task.IsCompleted);
        Assert.Equal(2, _store.SaveCount); // add + one completion
    }

    [Fact]
    public async Task Delete_RemovesAndSaves()
    {
        var keep = await _service.AddAsync(Draft("keep"));
        var drop = await _service.AddAsync(Draft("drop"));

        await _service.DeleteAsync(drop.Id);

        Assert.Equal([keep], _service.Tasks);
        Assert.Equal([keep.Id], _store.Saved.Select(t => t.Id));
    }

    [Fact]
    public async Task Changed_IsRaisedForEveryChange()
    {
        var count = 0;
        _service.Changed += (_, _) => count++;

        var task = await _service.AddAsync(Draft("A"));
        await _service.UpdateAsync(task.Id, Draft("B"));
        await _service.SetCompletedAsync(task.Id, true);
        await _service.DeleteAsync(task.Id);

        Assert.Equal(4, count);
    }

    [Fact]
    public async Task Load_ReplacesTasksAndReturnsWarning()
    {
        _store.Saved = [Item("from disk")];
        _store.LoadWarning = "careful";

        var warning = await _service.LoadAsync(TestContext.Current.CancellationToken);

        Assert.Equal("careful", warning);
        Assert.Equal("from disk", Assert.Single(_service.Tasks).Title);
    }

    [Fact]
    public async Task SaveFailure_OnAdd_RollsBack()
    {
        _store.FailSaves = true;
        await Assert.ThrowsAsync<TaskStoreException>(() => _service.AddAsync(Draft("unsaved")));
        Assert.Empty(_service.Tasks);
    }

    [Fact]
    public async Task SaveFailure_OnUpdate_RestoresOldValues()
    {
        var task = await _service.AddAsync(Draft("Before", Priority.Low, Today, "old"));
        _store.FailSaves = true;

        await Assert.ThrowsAsync<TaskStoreException>(() => _service.UpdateAsync(task.Id, Draft("After", Priority.High, null, "new")));

        Assert.Equal("Before", task.Title);
        Assert.Equal(Priority.Low, task.Priority);
        Assert.Equal(Today, task.DueDate);
        Assert.Equal("old", task.Description);
    }

    [Fact]
    public async Task SaveFailure_OnDelete_PutsTaskBackInItsPlace()
    {
        var a = await _service.AddAsync(Draft("a"));
        var b = await _service.AddAsync(Draft("b"));
        var c = await _service.AddAsync(Draft("c"));
        _store.FailSaves = true;

        await Assert.ThrowsAsync<TaskStoreException>(() => _service.DeleteAsync(b.Id));

        Assert.Equal([a, b, c], _service.Tasks);
    }

    [Fact]
    public async Task SaveFailure_OnComplete_Reverts_AndRaisesChangedAgain()
    {
        var task = await _service.AddAsync(Draft("a"));
        _store.FailSaves = true;
        var changes = 0;
        _service.Changed += (_, _) => changes++;

        await Assert.ThrowsAsync<TaskStoreException>(() => _service.SetCompletedAsync(task.Id, true));

        Assert.False(task.IsCompleted);
        Assert.Equal(2, changes); // once for the change, once for the undo
    }

    [Fact]
    public async Task ChangesBeforeLoad_AreRejected_WithoutTouchingMemory()
    {
        var service = new TaskService(new FakeTaskStore(), new FixedTimeProvider());
        await Assert.ThrowsAsync<TaskStoreException>(() => service.AddAsync(Draft("too early")));
        Assert.Empty(service.Tasks);
    }

    [Fact]
    public async Task SavedSnapshot_IsACopy_NotTheLiveObjects()
    {
        var task = await _service.AddAsync(Draft("a"));
        Assert.NotSame(task, Assert.Single(_store.Saved));
        Assert.Equal(task.Id, _store.Saved[0].Id);
    }

    [Fact]
    public async Task NewerFileVersion_LoadsReadOnly()
    {
        using var folder = new TempFolder();
        var path = folder.File("tasks.json");
        await File.WriteAllTextAsync(path, """{ "version": 99, "tasks": [ { "title": "from the future" } ] }""",
            TestContext.Current.CancellationToken);
        var service = new TaskService(new JsonTaskStore(path), new FixedTimeProvider());

        var warning = await service.LoadAsync(TestContext.Current.CancellationToken);

        Assert.NotNull(warning);
        Assert.Single(service.Tasks);
        await Assert.ThrowsAsync<TaskStoreException>(() => service.AddAsync(Draft("x")));
        Assert.Contains("\"version\": 99", await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task FailedLoad_BlocksSaving_SoTheFileIsNeverOverwritten()
    {
        var store = new FakeTaskStore { FailLoad = true };
        var service = new TaskService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<TaskStoreException>(() => service.LoadAsync(TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<TaskStoreException>(() => service.AddAsync(Draft("x")));
        Assert.Equal(0, store.SaveCount);
    }

    [Fact]
    public async Task WithRealJsonStore_TasksSurviveARestart()
    {
        using var folder = new TempFolder();
        var path = folder.File("tasks.json");

        var first = new TaskService(new JsonTaskStore(path), new FixedTimeProvider());
        await first.LoadAsync(TestContext.Current.CancellationToken);
        var task = await first.AddAsync(Draft("Persist me", Priority.High, Today));
        await first.SetCompletedAsync(task.Id, true);

        // "Restart": a brand new service reading the same file.
        var second = new TaskService(new JsonTaskStore(path), new FixedTimeProvider());
        await second.LoadAsync(TestContext.Current.CancellationToken);

        var reloaded = Assert.Single(second.Tasks);
        Assert.Equal("Persist me", reloaded.Title);
        Assert.True(reloaded.IsCompleted);
        Assert.Equal(Priority.High, reloaded.Priority);
    }
}
