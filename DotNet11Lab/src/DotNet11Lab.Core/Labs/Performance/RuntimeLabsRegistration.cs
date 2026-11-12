using DotNet11Lab.Core.Labs.NativeAot;
using DotNet11Lab.Core.Labs.Performance;
using DotNet11Lab.Core.Labs.RuntimeAsync;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace DotNet11Lab.Core;

// Labs 5, 7 and 8 (runtime performance, runtime async, Native AOT).
public static partial class LabServiceRegistration
{
    static partial void RegisterPerformanceLab(IServiceCollection services, IConfiguration configuration)
    {
        AddResultsLocator(services, configuration);
        services.TryAddSingleton<BenchmarkResultsStore>();
        services.TryAddSingleton<LivePerformanceRunner>();
        services.TryAddSingleton(sp =>
        {
            // Default: <content root>/App_Data/perf-journal.db. Relative configured paths resolve against the content root.
            var root = ContentRoot(sp);
            var configured = configuration[PerformanceJournal.ConfigurationKey];
            var path = string.IsNullOrWhiteSpace(configured)
                ? Path.Combine(root, "App_Data", "perf-journal.db")
                : Path.GetFullPath(configured, root);
            return new PerformanceJournal(path);
        });
    }

    static partial void RegisterRuntimeAsyncLab(IServiceCollection services) =>
        services.TryAddSingleton<RuntimeAsyncLab>();

    static partial void RegisterNativeAotLab(IServiceCollection services, IConfiguration configuration)
    {
        AddResultsLocator(services, configuration);
        services.TryAddSingleton<PublishResultsStore>();
    }

    private static void AddResultsLocator(IServiceCollection services, IConfiguration configuration) =>
        services.TryAddSingleton(sp => new LabResultsLocator(configuration[LabResultsLocator.ConfigurationKey], ContentRoot(sp)));

    private static string ContentRoot(IServiceProvider sp) =>
        sp.GetService<IHostEnvironment>()?.ContentRootPath ?? AppContext.BaseDirectory;
}
