using TaskFlow.Core.Models;
using TaskFlow.Core.Services;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public sealed class JsonTaskStoreTests : IDisposable
{
    private readonly TempFolder _folder = new();
    private readonly JsonTaskStore _store;

    public JsonTaskStoreTests()
    {
        _store = new JsonTaskStore(_folder.File("tasks.json"), time: new FixedTimeProvider());
    }

    public void Dispose() => _folder.Dispose();

    private CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task MissingFile_LoadsEmpty_WithoutWarning()
    {
        var result = await _store.LoadAsync(Ct);
        Assert.Empty(result.Tasks);
        Assert.Null(result.Warning);
    }

    [Fact]
    public async Task SaveThenLoad_RoundTripsEveryField()
    {
        var original = Item("Round trip", Priority.High, Today.AddDays(2), completed: true);
        original.Description = "Line 1\nLine 2 with \"quotes\" and émojis 🎉";

        await _store.SaveAsync([original], Ct);
        var loaded = Assert.Single((await _store.LoadAsync(Ct)).Tasks);

        Assert.Equal(original.Id, loaded.Id);
        Assert.Equal(original.Title, loaded.Title);
        Assert.Equal(original.Description, loaded.Description);
        Assert.Equal(original.DueDate, loaded.DueDate);
        Assert.Equal(original.Priority, loaded.Priority);
        Assert.Equal(original.IsCompleted, loaded.IsCompleted);
        Assert.Equal(original.CreatedAt, loaded.CreatedAt);
    }

    [Fact]
    public async Task SavedFile_IsReadableJson_WithVersionAndEnumNames()
    {
        await _store.SaveAsync([Item("Readable", Priority.Low, new DateOnly(2026, 5, 1))], Ct);
        var json = await File.ReadAllTextAsync(_store.FilePath, Ct);

        Assert.Contains("\"version\": 1", json);
        Assert.Contains("\"priority\": \"Low\"", json);
        Assert.Contains("\"dueDate\": \"2026-05-01\"", json);
        Assert.False(File.Exists(_store.FilePath + ".tmp"));
    }

    [Fact]
    public async Task Save_CreatesMissingFolders()
    {
        var nested = new JsonTaskStore(_folder.File(Path.Combine("a", "b", "tasks.json")));
        await nested.SaveAsync([Item("x")], Ct);
        Assert.True(File.Exists(nested.FilePath));
    }

    [Fact]
    public async Task Save_ReplacesPreviousContents()
    {
        await _store.SaveAsync([Item("one"), Item("two")], Ct);
        await _store.SaveAsync([Item("three")], Ct);
        Assert.Equal(["three"], (await _store.LoadAsync(Ct)).Tasks.Select(t => t.Title));
    }

    [Theory]
    [InlineData("this is not json")]
    [InlineData("{ \"version\": 1, \"tasks\": [ { \"title\": ")]
    [InlineData("{ \"version\": 1, \"tasks\": [ { \"id\": \"00000000-0000-0000-0000-000000000001\" } ] }")] // title is required
    [InlineData("{ \"version\": 1, \"tasks\": [ { \"title\": \"x\", \"priority\": \"Urgent\" } ] }")]   // unknown enum name
    [InlineData("{ \"version\": 1 }")]
    [InlineData("null")]
    [InlineData("")]
    public async Task CorruptFile_LoadsEmpty_WarnsAndKeepsBackup(string contents)
    {
        await File.WriteAllTextAsync(_store.FilePath, contents, Ct);

        var result = await _store.LoadAsync(Ct);

        Assert.Empty(result.Tasks);
        Assert.NotNull(result.Warning);
        Assert.False(File.Exists(_store.FilePath));
        var backup = Assert.Single(Directory.GetFiles(_folder.Path, "tasks.corrupt-*.json"));
        Assert.Equal(contents, await File.ReadAllTextAsync(backup, Ct));
    }

    [Fact]
    public async Task SmallProblems_AreRepaired_NotRejected()
    {
        const string json = """
            { "version": 1, "tasks": [
              null,
              { "id": "00000000-0000-0000-0000-000000000001", "title": "  padded  ", "priority": 7 },
              { "id": "00000000-0000-0000-0000-000000000001", "title": "duplicate id" },
              { "id": "00000000-0000-0000-0000-000000000002", "title": "", "description": null }
            ] }
            """;
        await File.WriteAllTextAsync(_store.FilePath, json, Ct);

        var result = await _store.LoadAsync(Ct);

        Assert.Null(result.Warning);
        Assert.Equal(2, result.Tasks.Count);
        Assert.Equal("padded", result.Tasks[0].Title);
        Assert.Equal(Priority.Medium, result.Tasks[0].Priority);
        Assert.Equal("(untitled)", result.Tasks[1].Title);
        Assert.Equal(string.Empty, result.Tasks[1].Description);
    }

    [Fact]
    public async Task UnknownFields_AreIgnored()
    {
        await File.WriteAllTextAsync(_store.FilePath,
            """{ "version": 1, "futureField": true, "tasks": [ { "title": "ok", "tags": ["a"] } ] }""", Ct);
        Assert.Equal("ok", Assert.Single((await _store.LoadAsync(Ct)).Tasks).Title);
    }

    [Fact]
    public async Task Save_WhenPathIsADirectory_ThrowsTaskStoreException()
    {
        Directory.CreateDirectory(_store.FilePath); // a folder where the file should be
        await Assert.ThrowsAsync<TaskStoreException>(() => _store.SaveAsync([Item("x")], Ct));
    }

    [Fact]
    public async Task Load_WhenPathIsADirectory_LoadsEmpty()
    {
        Directory.CreateDirectory(_store.FilePath + ".d");
        var store = new JsonTaskStore(_store.FilePath + ".d");
        // File.Exists is false for a directory, so this loads empty rather than throwing.
        Assert.Empty((await store.LoadAsync(Ct)).Tasks);
    }
}
