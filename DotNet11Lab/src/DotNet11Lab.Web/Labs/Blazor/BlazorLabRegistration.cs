using DotNet11Lab.Core.Labs.Blazor;
using DotNet11Lab.Core.Labs.Blazor.Components;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace DotNet11Lab.Web;

public static partial class LabWebServices
{
    static partial void RegisterBlazorLab(IServiceCollection services)
    {
        services.TryAddSingleton(TimeProvider.System);
        // Generated on first use (100,000 rows), then shared read-only by every circuit.
        services.TryAddSingleton(_ => new TransactionDataset(TransactionDataset.DefaultCount));
        services.TryAddSingleton<AccountDirectoryOptions>();
        services.TryAddSingleton<AccountDirectory>();
        services.TryAddSingleton<SummaryLoader>();
        // Scoped = one instance per circuit for interactive server components.
        services.TryAddScoped<BlazorLabState>();
    }
}
