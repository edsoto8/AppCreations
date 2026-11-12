namespace DotNet11Lab.Web;

/// <summary>Web-only service registrations. Each lab implements its partial method in its own file.</summary>
public static partial class LabWebServices
{
    public static IServiceCollection AddLabWeb(this IServiceCollection services)
    {
        services.AddHttpClient();
        RegisterApiPlayground(services);
        RegisterBlazorLab(services);
        return services;
    }

    static partial void RegisterApiPlayground(IServiceCollection services);
    static partial void RegisterBlazorLab(IServiceCollection services);
}
