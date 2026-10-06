using BoardFlow.App.ViewModels;
using BoardFlow.Core;
using BoardFlow.Data;
using BoardFlow.Data.Repositories;
using BoardFlow.Data.Schema;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Serilog.Extensions.Logging;

namespace BoardFlow.App.Infrastructure;

public static class AppServices
{
    /// <summary>Registers everything the app needs. Everything is a singleton: there is one window and one database.</summary>
    public static ServiceProvider Build(AppPaths paths, Serilog.ILogger logger, IClock? clock = null)
    {
        var services = new ServiceCollection();
        services.AddLogging(builder => builder.AddProvider(new SerilogLoggerProvider(logger)));
        services.AddSingleton(paths);
        services.AddSingleton(clock ?? new SystemClock());
        services.AddSingleton(_ => new BoardFlowDatabase(paths.DatabasePath));
        services.AddSingleton<DatabaseInitializer>(sp => new DatabaseInitializer(
            sp.GetRequiredService<BoardFlowDatabase>(), sp.GetRequiredService<ILogger<DatabaseInitializer>>()));

        services.AddSingleton<WorkspaceRepository>();
        services.AddSingleton<BoardRepository>();
        services.AddSingleton<ColumnRepository>();
        services.AddSingleton<CardRepository>();
        services.AddSingleton<LabelRepository>();
        services.AddSingleton<SettingsRepository>();

        services.AddSingleton<DialogHost>();
        services.AddSingleton<PanelHost>();
        services.AddSingleton<Notifier>();
        services.AddSingleton<BoardServices>();
        services.AddSingleton<MainViewModel>();
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
    }
}
