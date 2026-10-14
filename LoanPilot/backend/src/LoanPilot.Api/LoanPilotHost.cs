using System.Text.Json;
using System.Text.Json.Serialization;
using LoanPilot.Core.Engine;
using LoanPilot.Data;
using LoanPilot.Data.Repositories;
using LoanPilot.Data.Schema;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http.Json;
using Serilog;

namespace LoanPilot.Api;

public static class LoanPilotHost
{
    public static WebApplication Build(string[] args)
    {
        Directory.CreateDirectory(Path.Combine(AppContext.BaseDirectory, "wwwroot"));
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppContext.BaseDirectory,
            WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot"),
        });
        builder.Configuration.AddCommandLine(args, new Dictionary<string, string> { ["--data-dir"] = "LoanPilot:DataDirectory" });

        // Resolved from the final configuration (tests and --data-dir can override it).
        builder.Services.AddSingleton(sp => new DataPaths(ResolveDataDirectory(sp.GetRequiredService<IConfiguration>())));
        builder.Services.AddSerilog((services, config) => config
            .MinimumLevel.Information()
            .MinimumLevel.Override("Microsoft.AspNetCore", Serilog.Events.LogEventLevel.Warning)
            .Enrich.FromLogContext()
            .WriteTo.Console()
            .WriteTo.File(Path.Combine(services.GetRequiredService<DataPaths>().LogDirectory, "loanpilot-.log"),
                rollingInterval: RollingInterval.Day, retainedFileCountLimit: 14));

        builder.Services.Configure<JsonOptions>(options =>
        {
            options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
            options.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: false));
        });
        builder.Services.AddProblemDetails();

        // Malformed JSON must reach the exception handler in every environment so the client gets a
        // readable 400 (by default minimal APIs only throw in Development and otherwise send an empty 400).
        builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(options => options.ThrowOnBadRequest = true);
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton(sp => new LoanPilotDatabase(sp.GetRequiredService<DataPaths>().DatabasePath));
        builder.Services.AddSingleton<DatabaseInitializer>();
        builder.Services.AddSingleton<LoanRepository>();
        builder.Services.AddSingleton<ScenarioRepository>();
        builder.Services.AddSingleton<PaymentRecordRepository>();
        builder.Services.AddSingleton<PreferencesRepository>();
        builder.Services.AddScoped<LoanWorkspace>();
        builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
            policy.WithOrigins("http://localhost:5173", "http://127.0.0.1:5173").AllowAnyHeader().AllowAnyMethod()));

        var app = builder.Build();
        var init = app.Services.GetRequiredService<DatabaseInitializer>().Initialize();
        app.Logger.LogInformation("LoanPilot data directory {DataDirectory} (database {Outcome})",
            app.Services.GetRequiredService<DataPaths>().Root, init.Outcome);

        app.UseExceptionHandler(handler => handler.Run(HandleException));
        app.UseSerilogRequestLogging(options => options.GetLevel = (context, _, ex) =>
            ex is not null || context.Response.StatusCode >= 500 ? Serilog.Events.LogEventLevel.Error
            : context.Request.Path.StartsWithSegments("/api") ? Serilog.Events.LogEventLevel.Information
            : Serilog.Events.LogEventLevel.Debug);
        app.UseCors();
        app.UseDefaultFiles();
        app.UseStaticFiles();

        app.MapLoanPilotApi();

        var index = Path.Combine(app.Environment.WebRootPath, "index.html");
        if (File.Exists(index))
        {
            app.MapFallbackToFile("index.html");
        }
        else
        {
            app.MapGet("/", () => Results.Text(
                "LoanPilot API is running. The web interface has not been built yet: run `npm install && npm run build` " +
                "in LoanPilot/frontend, then restart, or use `npm run dev` and open http://localhost:5173.", "text/plain"));
        }

        return app;
    }

    /// <summary>Where the database and logs live. The folders are created on first use.</summary>
    public sealed class DataPaths
    {
        public DataPaths(string root)
        {
            Root = root;
            Directory.CreateDirectory(LogDirectory);
        }

        public string Root { get; }
        public string DatabasePath => Path.Combine(Root, "loanpilot.db");
        public string LogDirectory => Path.Combine(Root, "logs");
    }

    /// <summary>--data-dir / LoanPilot:DataDirectory, otherwise the user's local app-data folder.</summary>
    public static string ResolveDataDirectory(IConfiguration configuration)
    {
        var configured = configuration["LoanPilot:DataDirectory"];
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return Path.GetFullPath(configured);
        }

        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(root))
        {
            root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "share");
        }

        return Path.Combine(root, "LoanPilot");
    }

    private static async Task HandleException(HttpContext context)
    {
        var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("LoanPilot.Errors");
        IResult result;
        switch (error)
        {
            case LoanValidationException validation:
                result = Results.ValidationProblem(
                    validation.Errors.GroupBy(e => e.Field).ToDictionary(g => g.Key, g => g.Select(e => e.Message).ToArray()),
                    title: "Please check the highlighted fields.");
                break;
            case BadHttpRequestException bad:
                logger.LogWarning(bad, "Bad request to {Path}", context.Request.Path);
                result = Results.ValidationProblem(
                    new Dictionary<string, string[]> { ["body"] = [ReadableBadRequest(bad)] },
                    title: "The request could not be read.");
                break;
            case PersistenceException persistence:
                logger.LogError(persistence, "Database error on {Path}", context.Request.Path);
                result = Results.Problem(statusCode: StatusCodes.Status500InternalServerError, title: "Database error",
                    detail: persistence.Message);
                break;
            default:
                logger.LogError(error, "Unhandled error on {Path}", context.Request.Path);
                result = Results.Problem(statusCode: StatusCodes.Status500InternalServerError, title: "Something went wrong",
                    detail: "An unexpected error occurred. Details were written to the log file.");
                break;
        }

        await result.ExecuteAsync(context);
    }

    private static string ReadableBadRequest(BadHttpRequestException bad) =>
        bad.InnerException is JsonException json
            ? $"Invalid JSON{(json.Path is { Length: > 0 } path ? $" at {path.TrimStart('$', '.')}" : "")}: check that numbers, dates (yyyy-mm-dd) and choices are valid."
            : bad.Message;
}
