using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace DotNet11Lab.Api;

/// <summary>Registers and maps the Lab 3 Minimal API. Used by the standalone host and by DotNet11Lab.Web.</summary>
public static class LabApiExtensions
{
    public static IServiceCollection AddLabApi(this IServiceCollection services)
    {
        services.AddProblemDetails();
        return services;
    }

    public static IEndpointRouteBuilder MapLabApi(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api");
        api.MapGet("/health", () => new { status = "ok", runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription });
        return endpoints;
    }
}
