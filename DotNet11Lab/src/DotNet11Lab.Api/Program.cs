using DotNet11Lab.Core;

namespace DotNet11Lab.Api;

/// <summary>
/// Standalone host for the Lab 3 API (http://localhost:5181). DotNet11Lab.Web hosts the same endpoints in-process,
/// so an explicit, namespaced entry point is used to avoid clashing with the dashboard's top-level Program.
/// </summary>
public static class ApiHost
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddLabCore(builder.Configuration, typeof(ApiHost).Assembly);
        builder.Services.AddLabApi();

        var app = builder.Build();
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        app.MapLabApi();
        app.Run();
    }
}
