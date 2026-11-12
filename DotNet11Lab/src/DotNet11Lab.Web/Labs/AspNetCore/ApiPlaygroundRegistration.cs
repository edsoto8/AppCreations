using DotNet11Lab.Web.Labs.AspNetCore;

namespace DotNet11Lab.Web;

public static partial class LabWebServices
{
    static partial void RegisterApiPlayground(IServiceCollection services)
    {
        services.AddHttpClient(ApiPlaygroundClient.HttpClientName, client => client.Timeout = TimeSpan.FromSeconds(15));
        services.AddScoped<ApiPlaygroundClient>();
    }
}
