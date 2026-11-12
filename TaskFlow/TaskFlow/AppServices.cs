using Microsoft.Extensions.Logging.Abstractions;
using TaskFlow.Services;
using Windows.Storage;

namespace TaskFlow;

/// <summary>
/// The composition root: the one place that creates the app's services and view models and wires them together.
/// It is plain constructor injection done by hand. A DI container would do the same thing for a bigger app.
/// </summary>
public sealed class AppServices
{
    public const string DataFileName = "tasks.json";

    /// <summary>Set this environment variable to keep tasks somewhere else (handy for trying things out).</summary>
    public const string DataFolderVariable = "TASKFLOW_DATA_DIR";

    private AppServices(Frame rootFrame, string dataFilePath, ILoggerFactory loggerFactory)
    {
        DataFilePath = dataFilePath;
        Time = TimeProvider.System;
        var store = new JsonTaskStore(dataFilePath, loggerFactory.CreateLogger<JsonTaskStore>(), Time);
        Tasks = new TaskService(store, Time, loggerFactory.CreateLogger<TaskService>());
        Navigation = new FrameNavigationService(rootFrame);
        Theme = new ThemeService();
        Theme.Attach(rootFrame);
        Dialogs = new ContentDialogService(() => rootFrame.XamlRoot, Theme);
        MainViewModel = new MainViewModel(Tasks, Navigation, Dialogs, Time);
    }

    public string DataFilePath { get; }

    public TimeProvider Time { get; }

    public TaskService Tasks { get; }

    public INavigationService Navigation { get; }

    public IDialogService Dialogs { get; }

    public ThemeService Theme { get; }

    /// <summary>One instance for the app's lifetime, so the main list keeps its filter and sort.</summary>
    public MainViewModel MainViewModel { get; }

    public static async Task<AppServices> CreateAsync(Frame rootFrame)
    {
        var loggerFactory = App.LoggerFactory ?? NullLoggerFactory.Instance;
        var folder = await GetDataFolderAsync();
        var path = Path.Combine(folder, DataFileName);
        loggerFactory.CreateLogger<AppServices>().LogInformation("Tasks are stored in {Path}", path);
        return new AppServices(rootFrame, path, loggerFactory);
    }

    /// <summary>A fresh editor view model each time the editor opens.</summary>
    public EditTaskViewModel CreateEditTaskViewModel(Guid? taskId) => new(Tasks, Navigation, taskId);

    /// <summary>
    /// The app's private data folder. ApplicationData.LocalFolder works on every Uno target:
    /// on desktop it is a normal folder (see README), on WebAssembly it is backed by the browser's IndexedDB.
    /// </summary>
    private static async Task<string> GetDataFolderAsync()
    {
        var overrideFolder = Environment.GetEnvironmentVariable(DataFolderVariable);
        if (!string.IsNullOrWhiteSpace(overrideFolder))
        {
            return overrideFolder;
        }

        // Awaiting a StorageFolder call first also makes sure the WebAssembly file system is ready
        // before we use System.IO on it.
        var folder = await ApplicationData.Current.LocalFolder
            .CreateFolderAsync("TaskFlow", CreationCollisionOption.OpenIfExists);
        return folder.Path;
    }
}
