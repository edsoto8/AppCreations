using Microsoft.Data.SqlClient;

namespace FileImporter.ConsoleApp;

/// <summary>Describes a connection string for logs without the user name or password.</summary>
internal static class ConnectionInfo
{
    public static string Describe(string connectionString)
    {
        try
        {
            var builder = new SqlConnectionStringBuilder(connectionString);
            return $"{builder.DataSource}/{builder.InitialCatalog}";
        }
        catch (ArgumentException)
        {
            return "(unreadable connection string)";
        }
    }
}
