using System.Globalization;
using System.IO;
using Microsoft.Extensions.Logging;

namespace StepRecorder.App;

/// <summary>
/// Minimal file logger: one file per day under <see cref="AppPaths.LogsDirectory"/>, older files removed
/// after <see cref="RetentionDays"/>. Callers must never log typed text, passwords or image data (spec §18).
/// </summary>
internal sealed class FileLoggerProvider : ILoggerProvider
{
    public const int RetentionDays = 14;

    private readonly object gate = new();
    private readonly StreamWriter writer;

    public FileLoggerProvider(string directory)
    {
        Directory.CreateDirectory(directory);
        DeleteOldLogs(directory);

        FilePath = Path.Combine(directory, $"steprecorder-{DateTime.Now:yyyyMMdd}.log");
        var stream = new FileStream(FilePath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
        writer = new StreamWriter(stream) { AutoFlush = true };
    }

    public string FilePath { get; }

    public ILogger CreateLogger(string categoryName) => new FileLogger(this, categoryName);

    public void Dispose()
    {
        lock (gate)
        {
            writer.Dispose();
        }
    }

    private void Write(LogLevel level, string category, string message, Exception? exception)
    {
        string line = string.Create(
            CultureInfo.InvariantCulture,
            $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} [{level}] {category}: {message}");

        lock (gate)
        {
            try
            {
                writer.WriteLine(line);
                if (exception is not null)
                {
                    writer.WriteLine(exception);
                }
            }
            catch (Exception ex) when (ex is IOException or ObjectDisposedException)
            {
                // Logging must never take the recorder down.
            }
        }
    }

    private static void DeleteOldLogs(string directory)
    {
        DateTime cutoff = DateTime.Now.AddDays(-RetentionDays);
        foreach (string file in Directory.EnumerateFiles(directory, "steprecorder-*.log"))
        {
            try
            {
                if (File.GetLastWriteTime(file) < cutoff)
                {
                    File.Delete(file);
                }
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Try again next start.
            }
        }
    }

    private sealed class FileLogger(FileLoggerProvider provider, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel >= LogLevel.Information;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (IsEnabled(logLevel))
            {
                provider.Write(logLevel, category, formatter(state, exception), exception);
            }
        }
    }
}
