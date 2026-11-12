using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace DotNet11Lab.Core;

public static partial class LabServiceRegistration
{
    static partial void RegisterCSharp15Lab(IServiceCollection services)
    {
        // The order state machine stamps transitions with the current time; tests substitute a fake clock.
        services.TryAddSingleton(TimeProvider.System);
    }
}
