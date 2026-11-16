using FileImporter.ConsoleApp;
using FileImporter.Core;
using FileImporter.Core.Configuration;
using FileImporter.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Serilog;

// Exit codes: 0 = every file imported (or nothing to do), 1 = at least one file failed, 2 = the run could not start or crashed.
Log.Logger = new LoggerConfiguration().WriteTo.Console().CreateBootstrapLogger();

try
{
    // Run from the application folder so appsettings.json, relative paths and the log folder work the same
    // from a scheduled task, a service account or a shell in another folder.
    Environment.CurrentDirectory = AppContext.BaseDirectory;

    // Configuration, later sources win: appsettings.json, appsettings.{DOTNET_ENVIRONMENT}.json,
    // user secrets (Development only), environment variables (e.g. Database__ConnectionString), command line.
    var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
    {
        Args = args,
        ContentRootPath = AppContext.BaseDirectory,
    });

    builder.Services.AddSerilog((_, logger) => logger.ReadFrom.Configuration(builder.Configuration));
    builder.Services.AddImportOptions(builder.Configuration);
    builder.Services.AddFileImporter();

    using var host = builder.Build();
    await host.StartAsync(); // validates options; Ctrl+C / SIGTERM now cancel the token below

    var lifetime = host.Services.GetRequiredService<IHostApplicationLifetime>();
    var database = host.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value;
    Log.Information("NCR dispute file import starting. Database {Database}, source {SourceDirectory}",
        ConnectionInfo.Describe(database.ConnectionString),
        host.Services.GetRequiredService<IOptions<ImportOptions>>().Value.SourceDirectory);

    var summary = await host.Services.GetRequiredService<FileImportService>().RunAsync(lifetime.ApplicationStopping);

    await host.StopAsync();
    return summary.Succeeded ? 0 : 1;
}
catch (OperationCanceledException)
{
    Log.Warning("Import run cancelled");
    return 2;
}
catch (OptionsValidationException ex)
{
    Log.Fatal("Invalid configuration: {Errors}", string.Join("; ", ex.Failures));
    return 2;
}
catch (Exception ex)
{
    Log.Fatal(ex, "Import run failed");
    return 2;
}
finally
{
    await Log.CloseAndFlushAsync();
}
