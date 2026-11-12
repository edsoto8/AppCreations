using DotNet11Lab.Api.Commerce;
using DotNet11Lab.Api.Errors;
using DotNet11Lab.Api.Payments;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.OpenApi;

namespace DotNet11Lab.Api;

public sealed record HealthStatus(string Status, string Runtime);

/// <summary>Registers and maps the Lab 3 Minimal API. Used by the standalone host and by DotNet11Lab.Web.</summary>
public static class LabApiExtensions
{
    /// <summary>Name of the default document, served at /openapi/v1.json (OpenAPI 3.2).</summary>
    public const string OpenApi32Document = "v1";
    /// <summary>Same API described as OpenAPI 3.1, served at /openapi/v1-3.1.json for comparison.</summary>
    public const string OpenApi31Document = "v1-3.1";

    public static IServiceCollection AddLabApi(this IServiceCollection services)
    {
        // <snippet:AspNetCore.AddLabApi>
        services.AddValidation();                       // runs sync + async DataAnnotations for every endpoint
        services.AddProblemDetails(o => o.CustomizeProblemDetails = ApiProblems.Customize);
        services.AddExceptionHandler<ApiExceptionHandler>();
        // Development defaults ThrowOnBadRequest to true (binding failures become exceptions). Off, an unreadable body
        // (bad JSON, or a union matching no case) is answered with a 400 ValidationProblem keyed by JSON path ("$.method").
        services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = false);

        services.AddOpenApi(OpenApi32Document, o => Describe(o, "3.2 (default)"));   // OpenApiVersion defaults to 3.2
        services.AddOpenApi(OpenApi31Document, o =>
        {
            o.OpenApiVersion = OpenApiSpecVersion.OpenApi3_1;
            Describe(o, "3.1 (comparison)");
        });
        // </snippet:AspNetCore.AddLabApi>

        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<CommerceDirectoryOptions>();
        services.TryAddSingleton<CommerceDirectory>();
        services.TryAddSingleton<OrderStore>();
        services.TryAddSingleton<CheckoutService>();
        services.TryAddSingleton<PaymentProcessor>();
        return services;
    }

    public static IEndpointRouteBuilder MapLabApi(this IEndpointRouteBuilder endpoints)
    {
        var api = endpoints.MapGroup("/api")
            .AddEndpointFilter<ApiExceptionFilter>();

        api.MapGet("/health", () => TypedResults.Ok(new HealthStatus("ok", System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription)))
            .WithTags("Diagnostics")
            .WithSummary("Liveness probe");
        api.MapCommerceEndpoints();

        endpoints.MapOpenApi();                          // /openapi/{documentName}.json
        return endpoints;
    }

    private static void Describe(Microsoft.AspNetCore.OpenApi.OpenApiOptions options, string flavour) =>
        options.AddDocumentTransformer((document, _, _) =>
        {
            document.Info.Title = "DotNet 11 Lab commerce API";
            document.Info.Version = "v1";
            document.Info.Description = $"Lab 3 playground API, OpenAPI {flavour}. Async validation, C# 15 unions in JSON bodies and ProblemDetails errors.";
            return Task.CompletedTask;
        });
}
