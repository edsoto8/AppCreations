using DotNet11Lab.Api;
using DotNet11Lab.Core;
using DotNet11Lab.Web;
using DotNet11Lab.Web.Components;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using Serilog;

// Plain (non-reloadable) bootstrap logger for startup failures. A ReloadableLogger can only be frozen once per
// process, which breaks hosting several instances (e.g. WebApplicationFactory fixtures in the test run).
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .CreateLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    builder.Services.AddSerilog((services, lc) => lc
        .ReadFrom.Configuration(builder.Configuration)
        .ReadFrom.Services(services)
        .Enrich.FromLogContext()
        .WriteTo.Console(outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {SourceContext}: {Message:lj}{NewLine}{Exception}"));

    // ASP.NET Core 11 emits activities and metrics natively ("Microsoft.AspNetCore" source/meter), so no
    // OpenTelemetry.Instrumentation.AspNetCore package is needed. The console exporter is opt-in via config.
    var otel = builder.Services.AddOpenTelemetry()
        .ConfigureResource(r => r.AddService("DotNet11Lab.Web"))
        .WithTracing(t => t
            .AddSource("Microsoft.AspNetCore", LabTelemetry.SourceName)
            .AddHttpClientInstrumentation())
        .WithMetrics(m => m
            .AddMeter("Microsoft.AspNetCore.Hosting", "Microsoft.AspNetCore.Server.Kestrel", LabTelemetry.SourceName));
    if (builder.Configuration.GetValue<bool>("Telemetry:ConsoleExporter"))
    {
        otel.WithTracing(t => t.AddConsoleExporter()).WithMetrics(m => m.AddConsoleExporter());
    }

    builder.Services.AddRazorComponents()
        .AddInteractiveServerComponents()
        // Labs accept pasted input larger than SignalR's 32 KB default (Lab 2 CSV: 200,000 chars; Lab 3 bodies: 32 KB
        // plus framing). Without this, oversized input silently drops the circuit instead of reaching the labs'
        // own validation messages.
        .AddHubOptions(o => o.MaximumReceiveMessageSize = 1024 * 1024);

    builder.Services.AddLabCore(builder.Configuration,
        typeof(LabApiExtensions).Assembly,
        typeof(DotNet11Lab.RuntimeAsync.RuntimeAsyncAssembly).Assembly,
        typeof(Program).Assembly);
    builder.Services.AddLabApi();
    builder.Services.AddLabWeb();

    var app = builder.Build();

    if (!app.Environment.IsDevelopment())
    {
        app.UseExceptionHandler("/Error", createScopeForErrors: true);
    }
    app.UseSerilogRequestLogging();
    app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
    app.MapStaticAssets();
    app.MapLabApi();
    app.MapRazorComponents<App>()
        .AddInteractiveServerRenderMode();

    app.Run();
}
catch (Exception ex) when (ex is not HostAbortedException)
{
    Log.Fatal(ex, "DotNet11Lab.Web terminated unexpectedly");
    throw;
}
finally
{
    Log.CloseAndFlush();
}

public partial class Program;
