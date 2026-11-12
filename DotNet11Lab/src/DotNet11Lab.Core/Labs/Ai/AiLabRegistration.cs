using DotNet11Lab.Core.Labs.Ai;
using Microsoft.Extensions.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace DotNet11Lab.Core;

public static partial class LabServiceRegistration
{
    // <snippet:Ai.Registration>
    static partial void RegisterAiLab(IServiceCollection services, IConfiguration configuration)
    {
        // "Ai" section: Provider/Model/Endpoint from appsettings; ApiKey only from user secrets or Ai__ApiKey.
        services.Configure<AiOptions>(configuration.GetSection(AiOptions.SectionName));

        // The configured provider, wrapped in middleware. Consumers depend on IChatClient only.
        services.AddChatClient(sp => AiProviderFactory.CreateInnerClient(sp.GetRequiredService<IOptions<AiOptions>>().Value))
            .UseLabMiddleware();

        // A keyed mock pipeline with identical middleware, so a session can fall back to it at any time.
        services.AddKeyedChatClient(LabAssistant.MockKey, new LabAssistantChatClient())
            .UseLabMiddleware();

        services.AddSingleton<LabAssistant>();
    }
    // </snippet:Ai.Registration>
}
