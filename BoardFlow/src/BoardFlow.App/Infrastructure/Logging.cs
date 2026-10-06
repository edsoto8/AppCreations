using Avalonia.Logging;
using Serilog;
using AvaloniaLevel = Avalonia.Logging.LogEventLevel;
using SerilogLevel = Serilog.Events.LogEventLevel;

namespace BoardFlow.App.Infrastructure;

public static class Logging
{
    /// <summary>Daily rolling log files under the data folder, kept for 14 days.</summary>
    public static Serilog.ILogger Create(AppPaths paths, bool verbose = false) =>
        new LoggerConfiguration()
            .MinimumLevel.Is(verbose ? SerilogLevel.Debug : SerilogLevel.Information)
            .Enrich.WithProperty("Application", "BoardFlow")
            .WriteTo.File(
                Path.Combine(paths.LogDirectory, "boardflow-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 14,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff zzz} [{Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}")
            .CreateLogger();
}

/// <summary>Forwards Avalonia's own warnings and errors (e.g. binding failures) to Serilog.</summary>
public sealed class SerilogAvaloniaSink : ILogSink
{
    public bool IsEnabled(AvaloniaLevel level, string area) => level >= AvaloniaLevel.Warning;

    public void Log(AvaloniaLevel level, string area, object? source, string messageTemplate) =>
        Log(level, area, source, messageTemplate, []);

    public void Log(AvaloniaLevel level, string area, object? source, string messageTemplate, params object?[] propertyValues) =>
        Serilog.Log.ForContext("SourceContext", "Avalonia." + area)
            .Write((SerilogLevel)(int)level, messageTemplate, propertyValues);
}
