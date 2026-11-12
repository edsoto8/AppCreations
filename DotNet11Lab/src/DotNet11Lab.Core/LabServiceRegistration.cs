using System.Reflection;
using DotNet11Lab.Core.Source;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Core;

/// <summary>
/// Registers every lab's services. Each lab adds its registrations in its own file by implementing one of the
/// partial methods below, so labs can be developed independently without editing this file.
/// </summary>
public static partial class LabServiceRegistration
{
    public static IServiceCollection AddLabCore(this IServiceCollection services, IConfiguration configuration, params Assembly[] sourceAssemblies)
    {
        services.AddSingleton(new SourceCatalog([typeof(LabServiceRegistration).Assembly, .. sourceAssemblies]));

        RegisterCSharp15Lab(services);
        RegisterLinqLab(services);
        RegisterLibrariesLab(services);
        RegisterPerformanceLab(services, configuration);
        RegisterRuntimeAsyncLab(services);
        RegisterNativeAotLab(services, configuration);
        RegisterAiLab(services, configuration);
        return services;
    }

    static partial void RegisterCSharp15Lab(IServiceCollection services);
    static partial void RegisterLinqLab(IServiceCollection services);
    static partial void RegisterLibrariesLab(IServiceCollection services);
    static partial void RegisterPerformanceLab(IServiceCollection services, IConfiguration configuration);
    static partial void RegisterRuntimeAsyncLab(IServiceCollection services);
    static partial void RegisterNativeAotLab(IServiceCollection services, IConfiguration configuration);
    static partial void RegisterAiLab(IServiceCollection services, IConfiguration configuration);
}
