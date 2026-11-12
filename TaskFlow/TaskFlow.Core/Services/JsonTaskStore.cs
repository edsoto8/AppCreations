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

        TaskFile? file;
        try
        {
            await using var stream = File.OpenRead(FilePath);
            file = await JsonSerializer.DeserializeAsync(stream, TaskJsonContext.Default.TaskFile, cancellationToken);
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

        if (file.Version > CurrentVersion)
        {
            // Written by a newer TaskFlow. Reading it is fine, but saving could drop fields we don't know about.
            _logger.LogWarning("Task file version {Version} is newer than {Current}", file.Version, CurrentVersion);
        }

        var tasks = Sanitize(file.Tasks);
        _logger.LogInformation("Loaded {Count} tasks from {Path}", tasks.Count, FilePath);
        return new TaskLoadResult(tasks);
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
                var file = new TaskFile { Version = CurrentVersion, Tasks = [.. tasks] };
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
        var stamp = _time.GetUtcNow().ToString("yyyyMMdd-HHmmss");
        var backupPath = Path.ChangeExtension(FilePath, $".corrupt-{stamp}.json");
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

    /// <summary>Repairs small problems in otherwise valid JSON instead of rejecting the whole file.</summary>
    private static List<TaskItem> Sanitize(IEnumerable<TaskItem?> tasks)
    {
        var seen = new HashSet<Guid>();
        var result = new List<TaskItem>();
        foreach (var task in tasks)
        {
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

        public List<TaskItem?>? Tasks { get; set; }
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
internal sealed partial class TaskJsonContext : JsonSerializerContext;
