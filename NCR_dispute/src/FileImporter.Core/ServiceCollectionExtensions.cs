using FileImporter.Core.Abstractions;
using FileImporter.Core.Infrastructure;
using FileImporter.Core.Services;
using Microsoft.Extensions.DependencyInjection;

namespace FileImporter.Core;

public static class ServiceCollectionExtensions
{
    /// <summary>Registers the import services. Options are bound by the host (see FileImporter.Console/Program.cs).</summary>
    public static IServiceCollection AddFileImporter(this IServiceCollection services)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<RetryPolicy>();
        services.AddSingleton<IImportFileReader, CsvFileReader>();
        services.AddSingleton<IImportRepository, SqlImportRepository>();
        services.AddSingleton<IFileArchiver, FileArchiver>();
        services.AddSingleton<INotificationService, SmtpNotificationService>();
        services.AddSingleton<FileImportService>();
        return services;
    }
}
