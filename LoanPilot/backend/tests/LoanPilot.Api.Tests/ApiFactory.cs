using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace LoanPilot.Api.Tests;

/// <summary>Starts the real API (same host builder as Program) against a database in a temp folder.</summary>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    public ApiFactory(string? dataDirectory = null)
    {
        DataDirectory = dataDirectory ?? Path.Combine(Path.GetTempPath(), "loanpilot-api-tests", Guid.NewGuid().ToString("N"));
        OwnsDirectory = dataDirectory is null;
    }

    public string DataDirectory { get; }
    private bool OwnsDirectory { get; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("LoanPilot:DataDirectory", DataDirectory);
        builder.UseEnvironment("Testing");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && OwnsDirectory)
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            try
            {
                Directory.Delete(DataDirectory, recursive: true);
            }
            catch (IOException)
            {
                // Log files may still be held briefly on some platforms; temp folders are cleaned eventually.
            }
        }
    }
}

internal static class Http
{
    public const string AsOf = "asOf=2026-10-14";

    public static readonly object ExistingLoan = new
    {
        name = "2023 Honda CR-V",
        vehicleMake = "Honda",
        vehicleModel = "CR-V",
        vehicleYear = 2023,
        lender = "Credit Union",
        originalAmount = 32_000m,
        aprPercent = 6.49m,
        termMonths = 72,
        startDate = "2024-03-10",
        firstPaymentDate = "2024-04-10",
        paymentFrequency = "monthly",
        accrualMethod = "dailySimple",
        dayCountBasis = "actual365",
        currentBalance = 21_480.55m,
        balanceAsOf = "2026-10-01",
        vehicleValue = 26_000m,
    };

    public static StringContent Json(object body) =>
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    public static async Task<JsonNode> ReadJson(this HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

    public static async Task<long> CreateLoan(this HttpClient client, object? body = null)
    {
        var response = await client.PostAsync($"/api/loans?{AsOf}", Json(body ?? ExistingLoan));
        Assert.Equal(System.Net.HttpStatusCode.Created, response.StatusCode);
        return (await response.ReadJson())["id"]!.GetValue<long>();
    }
}
