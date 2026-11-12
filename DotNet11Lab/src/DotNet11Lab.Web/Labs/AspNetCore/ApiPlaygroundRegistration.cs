using DotNet11Lab.Web.Labs.AspNetCore;

namespace DotNet11Lab.Web;

public static partial class LabWebServices
{
    static partial void RegisterApiPlayground(IServiceCollection services)
    {
        services.AddHttpClient(ApiPlaygroundClient.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(15))
            // Never follow redirects: a 3xx must be shown to the user, not used to reach another URL (SSRF guard).
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false });
        services.AddScoped<ApiPlaygroundClient>();
    }
}
