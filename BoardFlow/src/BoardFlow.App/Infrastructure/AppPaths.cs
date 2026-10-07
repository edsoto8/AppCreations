namespace BoardFlow.App.Infrastructure;

/// <summary>Where BoardFlow keeps its database and logs.</summary>
public sealed record AppPaths(string DataDirectory)
{
    public const string DataDirectoryVariable = "BOARDFLOW_DATA_DIR";

    public string DatabasePath => Path.Combine(DataDirectory, "boardflow.db");

    public string LogDirectory => Path.Combine(DataDirectory, "logs");

    /// <summary>
    /// <c>--data-dir &lt;path&gt;</c> wins, then the <c>BOARDFLOW_DATA_DIR</c> environment variable, then the
    /// per-user local application data folder (e.g. <c>%LOCALAPPDATA%\BoardFlow</c> or <c>~/.local/share/BoardFlow</c>).
    /// </summary>
    public static AppPaths Resolve(IReadOnlyList<string> args)
    {
        for (var i = 0; i < args.Count - 1; i++)
        {
            if (args[i] == "--data-dir")
            {
                return new AppPaths(Path.GetFullPath(args[i + 1]));
            }
        }

        var fromEnvironment = Environment.GetEnvironmentVariable(DataDirectoryVariable);
        if (!string.IsNullOrWhiteSpace(fromEnvironment))
        {
            return new AppPaths(Path.GetFullPath(fromEnvironment));
        }

        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create);
        return new AppPaths(Path.Combine(localData, "BoardFlow"));
    }
}
