using System.Diagnostics;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace DotNet11Lab.Api.Errors;

// <snippet:AspNetCore.ProblemFactory>
/// <summary>One place that decides status codes, titles and machine-readable error codes for the API.</summary>
public static class ApiProblems
{
    public static ProblemHttpResult NotFound(string detail) =>
        Create(StatusCodes.Status404NotFound, "Resource not found", detail, "not_found");

    public static ProblemHttpResult Conflict(string detail, string code, IDictionary<string, object?>? data = null) =>
        Create(StatusCodes.Status409Conflict, "The request conflicts with the current state", detail, code, data);

    public static ProblemHttpResult Unprocessable(string detail, string code, IDictionary<string, object?>? data = null) =>
        Create(StatusCodes.Status422UnprocessableEntity, "The request cannot be processed", detail, code, data);

    public static ProblemHttpResult Unexpected() =>
        Create(StatusCodes.Status500InternalServerError, "An unexpected error occurred", "The failure was logged; quote the traceId when reporting it.", "unexpected");

    private static ProblemHttpResult Create(int status, string title, string detail, string code, IDictionary<string, object?>? data = null)
    {
        var extensions = new Dictionary<string, object?>(data ?? new Dictionary<string, object?>()) { ["code"] = code };
        return TypedResults.Problem(detail, statusCode: status, title: title, extensions: extensions);
    }

    /// <summary>Applied to every ProblemDetails the app writes, including automatic validation responses.</summary>
    public static void Customize(ProblemDetailsContext context)
    {
        var http = context.HttpContext;
        context.ProblemDetails.Instance ??= $"{http.Request.Method} {http.Request.Path}";
        context.ProblemDetails.Extensions.TryAdd("traceId", Activity.Current?.Id ?? http.TraceIdentifier);
    }
}
// </snippet:AspNetCore.ProblemFactory>

// <snippet:AspNetCore.ExceptionFilter>
/// <summary>
/// Turns unhandled exceptions from /api endpoints into RFC 9457 problem+json (500) with a traceId, independent of
/// whichever exception middleware the host configured (the dashboard uses an HTML error page for its own routes).
/// </summary>
public sealed class ApiExceptionFilter(ILogger<ApiExceptionFilter> logger) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        try
        {
            return await next(context);
        }
        catch (Exception ex) when (!context.HttpContext.RequestAborted.IsCancellationRequested)
        {
            logger.LogError(ex, "Unhandled exception on {Method} {Path}", context.HttpContext.Request.Method, context.HttpContext.Request.Path);
            return ApiProblems.Unexpected();
        }
    }
}
// </snippet:AspNetCore.ExceptionFilter>

/// <summary>
/// Global <see cref="IExceptionHandler"/> for hosts that call <c>UseExceptionHandler()</c> (the standalone API host).
/// It only claims /api requests so a host's HTML error page keeps working for everything else.
/// </summary>
public sealed class ApiExceptionHandler(IProblemDetailsService problemDetails, ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (!httpContext.Request.Path.StartsWithSegments("/api")) return false;
        logger.LogError(exception, "Unhandled exception on {Method} {Path}", httpContext.Request.Method, httpContext.Request.Path);
        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status500InternalServerError,
                Title = "An unexpected error occurred",
                Detail = "The failure was logged; quote the traceId when reporting it.",
                Extensions = { ["code"] = "unexpected" },
            },
        });
    }
}
