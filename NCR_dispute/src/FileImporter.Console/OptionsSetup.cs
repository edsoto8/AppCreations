using System.Net.Mail;
using FileImporter.Core.Configuration;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace FileImporter.ConsoleApp;

/// <summary>Binds the configuration sections to the options classes and checks them when the host starts.</summary>
internal static class OptionsSetup
{
    public static IServiceCollection AddImportOptions(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<ImportOptions>()
            .Bind(configuration.GetSection(ImportOptions.SectionName))
            .Validate(o => !string.IsNullOrWhiteSpace(o.SourceDirectory), "Import:SourceDirectory is required.")
            .Validate(o => !string.IsNullOrWhiteSpace(o.FilePattern), "Import:FilePattern is required.")
            .Validate(o => !string.IsNullOrWhiteSpace(o.ArchiveFolderName) && o.ArchiveFolderName.IndexOfAny(Path.GetInvalidFileNameChars()) < 0,
                "Import:ArchiveFolderName must be a plain folder name.")
            .Validate(o => IsSupportedEncoding(o.Encoding), "Import:Encoding is not a known encoding name (e.g. utf-8, windows-1252).")
            .Validate(o => o.Columns.Count > 0, "Import:Columns must list at least one column.")
            .Validate(o => o.Columns.All(c => !string.IsNullOrWhiteSpace(c.SourceName)), "Every Import:Columns entry needs a SourceName.")
            .Validate(o => o.Columns.Select(c => c.Destination).Distinct(StringComparer.OrdinalIgnoreCase).Count() == o.Columns.Count,
                "Import:Columns has duplicate destination column names.")
            .ValidateOnStart();

        services.AddOptions<DatabaseOptions>()
            .Bind(configuration.GetSection(DatabaseOptions.SectionName))
            .Validate(o => !string.IsNullOrWhiteSpace(o.ConnectionString),
                "Database:ConnectionString is required. Set it with the environment variable Database__ConnectionString or user secrets.")
            .Validate(o => !string.IsNullOrWhiteSpace(o.StagingTable), "Database:StagingTable is required.")
            .Validate(o => !string.IsNullOrWhiteSpace(o.ImportIdColumn), "Database:ImportIdColumn is required.")
            .Validate(o => !string.IsNullOrWhiteSpace(o.ValidationProcedure), "Database:ValidationProcedure is required.")
            .Validate(o => o.BulkCopyBatchSize >= 0 && o.BulkCopyTimeoutSeconds >= 0 && o.CommandTimeoutSeconds >= 0,
                "Database batch size and timeouts cannot be negative.")
            .ValidateOnStart();

        services.AddOptions<SmtpOptions>()
            .Bind(configuration.GetSection(SmtpOptions.SectionName))
            .Validate(o => !o.Enabled || !string.IsNullOrWhiteSpace(o.Host), "Smtp:Host is required when Smtp:Enabled is true.")
            .Validate(o => !o.Enabled || IsEmail(o.From), "Smtp:From must be an e-mail address.")
            .Validate(o => !o.Enabled || (o.To.Count > 0 && o.To.All(IsEmail)), "Smtp:To must list at least one e-mail address.")
            .Validate(o => Enum.TryParse<SecureSocketOptions>(o.Security, ignoreCase: true, out _),
                "Smtp:Security must be None, Auto, SslOnConnect, StartTls or StartTlsWhenAvailable.")
            .ValidateOnStart();

        services.AddOptions<RetryOptions>()
            .Bind(configuration.GetSection(RetryOptions.SectionName))
            .Validate(o => o.MaxAttempts >= 1 && o.InitialDelaySeconds >= 0, "Retry:MaxAttempts must be at least 1 and Retry:InitialDelaySeconds not negative.")
            .ValidateOnStart();

        return services;
    }

    private static bool IsEmail(string? value) => MailAddress.TryCreate(value, out _);

    private static bool IsSupportedEncoding(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return false;
        }

        try
        {
            System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
            System.Text.Encoding.GetEncoding(name);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }
}
