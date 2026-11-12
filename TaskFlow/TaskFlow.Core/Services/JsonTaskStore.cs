using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using TaskFlow.Core.Models;

namespace TaskFlow.Core.Services;

/// <summary>
/// Saves tasks as a human-readable JSON file:
/// <code>{ "version": 1, "tasks": [ { "id": "...", "title": "...", "priority": "High", ... } ] }</code>
/// </summary>
public sealed class JsonTaskStore : ITaskStore
{
    public const int CurrentVersion = 1;

    private readonly ILogger<JsonTaskStore> _logger;
    private readonly TimeProvider _time;

    public JsonTaskStore(string filePath, ILogger<JsonTaskStore>? logger = null, TimeProvider? time = null)
    {
        FilePath = filePath;
        _logger = logger ?? NullLogger<JsonTaskStore>.Instance;
        _time = time ?? TimeProvider.System;
    }

    public string FilePath { get; }

    public async Task<TaskLoadResult> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(FilePath))
        {
            _logger.LogInformation("No task file at {Path}; starting with an empty list", FilePath);
            return new TaskLoadResult([]);
        }

        RawTaskFile? file;
        try
        {
            await using var stream = File.OpenRead(FilePath);
            file = await JsonSerializer.DeserializeAsync(stream, TaskJsonContext.Default.RawTaskFile, cancellationToken);
        }
        catch (JsonException ex)
        {
            return RecoverFromCorruptFile(ex);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogError(ex, "Could not read {Path}", FilePath);
            throw new TaskStoreException($"Couldn't open your saved tasks ({ex.Message}).", ex);
        }

        if (file?.Tasks is null)
        {
            return RecoverFromCorruptFile(null);
        }

        // Read each task on its own, so one damaged entry doesn't hide all the others.
        var tasks = new List<TaskItem?>();
        var skipped = 0;
        foreach (var element in file.Tasks)
        {
            try
            {
                tasks.Add(element.Deserialize(TaskJsonContext.Default.TaskItem));
            }
            catch (JsonException ex)
            {
                skipped++;
                _logger.LogWarning(ex, "Skipping an unreadable task in {Path}", FilePath);
            }
        }

        var result = Sanitize(tasks);
        _logger.LogInformation("Loaded {Count} tasks from {Path}", result.Count, FilePath);

        if (file.Version > CurrentVersion)
        {
            // Written by a newer TaskFlow. Show the tasks, but saving could drop data this version doesn't know.
            _logger.LogWarning("Task file version {Version} is newer than {Current}; opening read-only", file.Version, CurrentVersion);
            return new TaskLoadResult(
                result,
                "These tasks were saved by a newer version of TaskFlow. You can view them, but changes can't be saved.",
                IsReadOnly: true);
        }

        if (skipped > 0)
        {
            // The next save would drop the skipped entries, so keep a copy of the original file first.
            var backupPath = BackupPath();
            try
            {
                File.Copy(FilePath, backupPath, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                throw new TaskStoreException($"Some saved tasks are unreadable and the file couldn't be backed up ({ex.Message}).", ex);
            }

            var what = skipped == 1 ? "1 saved task couldn't be read and was" : $"{skipped} saved tasks couldn't be read and were";
            return new TaskLoadResult(result, $"{what} skipped. The original file was kept as {Path.GetFileName(backupPath)}.");
        }

        return new TaskLoadResult(result);
    }

    public async Task SaveAsync(IReadOnlyList<TaskItem> tasks, CancellationToken cancellationToken = default)
    {
        var tempPath = FilePath + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(FilePath))!);

            // Write to a temporary file first, then swap it in. If the app crashes halfway through writing,
            // the previous tasks.json is still intact.
            await using (var stream = File.Create(tempPath))
            {
                var file = new TaskFile { Version = CurrentVersion, Tasks = tasks.ToList() };
                await JsonSerializer.SerializeAsync(stream, file, TaskJsonContext.Default.TaskFile, cancellationToken);
            }

            File.Move(tempPath, FilePath, overwrite: true);
            _logger.LogDebug("Saved {Count} tasks to {Path}", tasks.Count, FilePath);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            _logger.LogError(ex, "Could not save tasks to {Path}", FilePath);
            throw new TaskStoreException($"Couldn't save your tasks ({ex.Message}).", ex);
        }
    }

    /// <summary>Keeps the unreadable file (renamed) so nothing is lost, and starts with an empty list.</summary>
    private TaskLoadResult RecoverFromCorruptFile(Exception? error)
    {
        var backupPath = BackupPath();
        _logger.LogWarning(error, "Task file {Path} is unreadable; moving it to {Backup}", FilePath, backupPath);

        try
        {
            File.Move(FilePath, backupPath, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // If we can't move it aside, refuse to continue: saving would overwrite the user's file.
            throw new TaskStoreException($"Your saved tasks are unreadable and couldn't be backed up ({ex.Message}).", ex);
        }

        return new TaskLoadResult(
            [],
            $"Your saved tasks couldn't be read, so TaskFlow started with an empty list. The old file was kept as {Path.GetFileName(backupPath)}.");
    }

    private string BackupPath() =>
        Path.ChangeExtension(FilePath, $".corrupt-{_time.GetUtcNow():yyyyMMdd-HHmmss}.json");

    /// <summary>Repairs small problems in otherwise valid JSON instead of rejecting the whole file.</summary>
    private static List<TaskItem> Sanitize(IEnumerable<TaskItem?> tasks)
    {
        var seen = new HashSet<Guid>();
        var result = new List<TaskItem>();
        foreach (var entry in tasks)
        {
            // A task written without an "id" deserializes with Guid.Empty: give it a real one.
            var task = entry is { Id: var id } && id == Guid.Empty
                ? new TaskItem
                {
                    Id = Guid.NewGuid(),
                    Title = entry.Title,
                    Description = entry.Description,
                    DueDate = entry.DueDate,
                    Priority = entry.Priority,
                    IsCompleted = entry.IsCompleted,
                    CreatedAt = entry.CreatedAt,
                }
                : entry;

            if (task is null || !seen.Add(task.Id))
            {
                continue; // skip null entries and duplicate ids
            }

            task.Title = string.IsNullOrWhiteSpace(task.Title) ? "(untitled)" : task.Title.Trim();
            task.Description ??= string.Empty;
            if (!Enum.IsDefined(task.Priority))
            {
                task.Priority = Priority.Medium;
            }

            result.Add(task);
        }

        return result;
    }

    /// <summary>The shape of the file on disk. The version lets future releases migrate old files.</summary>
    internal sealed class TaskFile
    {
        public int Version { get; set; }

        public List<TaskItem>? Tasks { get; set; }
    }

    /// <summary>The same file, read with each task left as raw JSON so tasks can be checked one at a time.</summary>
    internal sealed class RawTaskFile
    {
        public int Version { get; set; }

        public List<JsonElement>? Tasks { get; set; }
    }
}

/// <summary>
/// System.Text.Json source generation: the serializer code is generated at compile time instead of using
/// reflection at run time. That is faster and keeps working when the WebAssembly build trims unused code.
/// </summary>
[JsonSourceGenerationOptions(
    WriteIndented = true,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(JsonTaskStore.TaskFile))]
[JsonSerializable(typeof(JsonTaskStore.RawTaskFile))]
internal sealed partial class TaskJsonContext : JsonSerializerContext;
