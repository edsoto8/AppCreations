using System.IO.Compression;
using System.Net;
using System.Text;
using System.Xml.Linq;
using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Api.Tests;

public sealed class ApiTests : IDisposable
{
    private readonly ApiFactory _factory = new();
    private readonly HttpClient _client;

    public ApiTests() => _client = _factory.CreateClient();

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var json = await (await _client.GetAsync("/api/health")).ReadJson();
        Assert.Equal("ok", json["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task CrossSiteWrite_IsRejected_LocalOriginAllowed()
    {
        var id = await _client.CreateLoan();
        using var evil = new HttpRequestMessage(HttpMethod.Post, $"/api/loans/{id}/archive");
        evil.Headers.Add("Origin", "http://evil.example");
        Assert.Equal(HttpStatusCode.Forbidden, (await _client.SendAsync(evil)).StatusCode);
        Assert.False((await (await _client.GetAsync($"/api/loans/{id}")).ReadJson())["isArchived"]!.GetValue<bool>());

        using var local = new HttpRequestMessage(HttpMethod.Post, $"/api/loans/{id}/archive");
        local.Headers.Add("Origin", "http://localhost:5173");
        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(local)).StatusCode);
    }

    [Fact]
    public async Task ForeignHostHeader_IsRejected()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/loans");
        request.Headers.Host = "attacker.example";
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.SendAsync(request)).StatusCode);
    }

    [Fact]
    public async Task UnknownApiRoute_Returns404Problem()
    {
        var response = await _client.GetAsync("/api/nope");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task LoanLifecycle_CreateUpdateArchiveDelete()
    {
        var id = await _client.CreateLoan();
        var loan = await (await _client.GetAsync($"/api/loans/{id}")).ReadJson();
        Assert.Equal("dailySimple", loan["accrualMethod"]!.GetValue<string>());
        Assert.Equal(21_480.55m, loan["currentBalance"]!.GetValue<decimal>());

        var list = await (await _client.GetAsync($"/api/loans?{Http.AsOf}")).ReadJson();
        var item = list.AsArray().Single()!;
        Assert.Equal(21_480.55m, item["currentBalance"]!.GetValue<decimal>());
        Assert.Equal(32.87m, item["percentRepaid"]!.GetValue<decimal>()); // (32,000 − 21,480.55) ÷ 32,000

        var update = await _client.PutAsync($"/api/loans/{id}?{Http.AsOf}", Http.Json(new
        {
            name = "Renamed", originalAmount = 32_000m, aprPercent = 5.99m, termMonths = 72, startDate = "2024-03-10",
            firstPaymentDate = "2024-04-10", paymentFrequency = "monthly", accrualMethod = "monthly", dayCountBasis = "actual365",
        }));
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        Assert.Equal("Renamed", (await update.ReadJson())["name"]!.GetValue<string>());

        Assert.True((await (await _client.PostAsync($"/api/loans/{id}/archive", null)).ReadJson())["isArchived"]!.GetValue<bool>());
        Assert.Empty((await (await _client.GetAsync("/api/loans")).ReadJson()).AsArray());
        Assert.Single((await (await _client.GetAsync("/api/loans?includeArchived=true")).ReadJson()).AsArray());
        Assert.False((await (await _client.PostAsync($"/api/loans/{id}/unarchive", null)).ReadJson())["isArchived"]!.GetValue<bool>());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/loans/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/loans/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/loans/{id}")).StatusCode);
    }

    [Fact]
    public async Task InvalidLoan_Returns400WithFieldErrors()
    {
        var response = await _client.PostAsync($"/api/loans?{Http.AsOf}", Http.Json(new
        {
            name = "", originalAmount = -1m, aprPercent = 6m, termMonths = 60, startDate = "2024-01-01", firstPaymentDate = "2023-12-01",
            paymentFrequency = "monthly", accrualMethod = "monthly", dayCountBasis = "actual365", currentBalance = 5000m,
        }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var errors = (await response.ReadJson())["errors"]!.AsObject();
        Assert.Equal(["name", "originalAmount", "firstPaymentDate", "balanceAsOf"], errors.Select(e => e.Key));
    }

    [Fact]
    public async Task MalformedJsonAndUnknownEnum_Return400()
    {
        var bad = await _client.PostAsync("/api/loans", new StringContent("{not json", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var badEnum = await _client.PostAsync("/api/loans", Http.Json(new { name = "x", paymentFrequency = "fortnightly" }));
        Assert.Equal(HttpStatusCode.BadRequest, badEnum.StatusCode);
        Assert.True((await badEnum.ReadJson())["errors"]!["body"] is not null);
    }

    [Fact]
    public async Task Dashboard_MatchesEngineDirectly()
    {
        var id = await _client.CreateLoan();
        var dashboard = await (await _client.GetAsync($"/api/loans/{id}/dashboard?{Http.AsOf}")).ReadJson();

        var loan = new Loan
        {
            Name = "x", OriginalAmount = 32_000m, AprPercent = 6.49m, TermMonths = 72, StartDate = new DateOnly(2024, 3, 10),
            FirstPaymentDate = new DateOnly(2024, 4, 10), AccrualMethod = AccrualMethod.DailySimple,
            CurrentBalance = 21_480.55m, BalanceAsOf = new DateOnly(2026, 10, 1), VehicleValue = 26_000m,
        };
        var expected = LoanAnalyzer.Analyze(loan, new DateOnly(2026, 10, 14)).Status;
        var status = dashboard["status"]!;
        Assert.Equal(expected.RemainingInterest, status["remainingInterest"]!.GetValue<decimal>());
        Assert.Equal(expected.RemainingPayments, status["remainingPayments"]!.GetValue<int>());
        Assert.Equal(expected.PayoffDate!.Value.ToString("yyyy-MM-dd"), status["payoffDate"]!.GetValue<string>());
        Assert.Equal(expected.PayoffEstimate.Total, status["payoffEstimate"]!["total"]!.GetValue<decimal>());
        Assert.Equal(expected.Equity, status["equity"]!.GetValue<decimal>());
        Assert.Equal("unknown", status["interestPaidSource"]!.GetValue<string>());
        Assert.Null(status["projectedLifetimeCost"]);
        Assert.Equal(5, dashboard["savingsOptions"]!.AsArray().Count);
        Assert.NotEmpty(dashboard["insights"]!.AsArray());
        Assert.Equal("payment", dashboard["baseline"]!["rows"]![0]!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task Preview_ReturnsStatusForUnsavedLoan()
    {
        var json = await (await _client.PostAsync($"/api/calculate/preview?{Http.AsOf}", Http.Json(new
        {
            name = "Preview", originalAmount = 25_000m, aprPercent = 6m, termMonths = 60, startDate = "2026-09-01",
            firstPaymentDate = "2026-10-01", paymentFrequency = "monthly", accrualMethod = "monthly", dayCountBasis = "actual365",
        }))).ReadJson();
        Assert.Equal(483.32m, json["status"]!["standardPayment"]!.GetValue<decimal>());
        Assert.Equal(60, json["baseline"]!["paymentCount"]!.GetValue<int>() + json["status"]!["paymentsMade"]!.GetValue<int>());
        Assert.Empty((await (await _client.GetAsync("/api/loans")).ReadJson()).AsArray());
    }

    [Fact]
    public async Task SimulateTargetAndBudget()
    {
        var id = await _client.CreateLoan();
        var sim = await (await _client.PostAsync($"/api/loans/{id}/simulate?{Http.AsOf}", Http.Json(new
        {
            name = "", recurringExtras = new[] { new { amount = 100m } },
            lumpSums = new[] { new { amount = 1500m, date = "2026-12-15" } },
        }))).ReadJson();
        Assert.True(sim["comparison"]!["interestSaved"]!.GetValue<decimal>() > 0m);
        Assert.Contains(sim["scenario"]!["rows"]!.AsArray(), r => r!["kind"]!.GetValue<string>() == "lumpSum");

        var badSim = await _client.PostAsync($"/api/loans/{id}/simulate?{Http.AsOf}", Http.Json(new
        {
            lumpSums = new[] { new { amount = 0m, date = "2026-12-01" } },
        }));
        Assert.Equal(HttpStatusCode.BadRequest, badSim.StatusCode);
        Assert.NotNull((await badSim.ReadJson())["errors"]!["lumpSums[0].amount"]);

        // A lump sum dated before the balance date is accepted and reported as already paid.
        var pastLump = await (await _client.PostAsync($"/api/loans/{id}/simulate?{Http.AsOf}", Http.Json(new
        {
            lumpSums = new[] { new { amount = 1000m, date = "2026-09-01" } },
        }))).ReadJson();
        Assert.Contains(pastLump["scenario"]!["summary"]!["warnings"]!.AsArray(), w => w!["code"]!.GetValue<string>() == "lump-sum-already-paid");
        Assert.Equal(0m, pastLump["comparison"]!["interestSaved"]!.GetValue<decimal>());

        var target = await (await _client.PostAsync($"/api/loans/{id}/target-payoff?{Http.AsOf}", Http.Json(new { targetDate = "2028-12-31" }))).ReadJson();
        Assert.True(target["achievable"]!.GetValue<bool>());
        Assert.True(target["additionalAmount"]!.GetValue<decimal>() > 0m);
        Assert.True(string.CompareOrdinal(target["simulation"]!["scenario"]!["summary"]!["payoffDate"]!.GetValue<string>(), "2028-12-31") <= 0);

        var missingTarget = await _client.PostAsync($"/api/loans/{id}/target-payoff", Http.Json(new { }));
        Assert.Equal(HttpStatusCode.BadRequest, missingTarget.StatusCode);

        var budget = await (await _client.PostAsync($"/api/loans/{id}/budget?{Http.AsOf}", Http.Json(new { budget = 700m }))).ReadJson();
        Assert.True(budget["extraAmount"]!.GetValue<decimal>() > 0m);

        var lowBudget = await _client.PostAsync($"/api/loans/{id}/budget?{Http.AsOf}", Http.Json(new { budget = 100m }));
        Assert.Equal(HttpStatusCode.BadRequest, lowBudget.StatusCode);
        Assert.NotNull((await lowBudget.ReadJson())["errors"]!["budget"]);
    }

    [Fact]
    public async Task Scenarios_SaveCompareInsightsAndSchedule()
    {
        var id = await _client.CreateLoan();
        var noName = await _client.PostAsync($"/api/loans/{id}/scenarios?{Http.AsOf}", Http.Json(new { name = " ", recurringExtras = new[] { new { amount = 50m } } }));
        Assert.Equal(HttpStatusCode.BadRequest, noName.StatusCode);

        var created = await _client.PostAsync($"/api/loans/{id}/scenarios?{Http.AsOf}", Http.Json(new
        {
            name = "Tax refund + $75",
            recurringExtras = new[] { new { amount = 75m, startDate = (string?)"2026-11-01", endDate = (string?)null } },
            lumpSums = new[] { new { amount = 3000m, date = "2027-04-15", note = "Refund" } },
        }));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var scenarioId = (await created.ReadJson())["id"]!.GetValue<long>();

        var updated = await _client.PutAsync($"/api/loans/{id}/scenarios/{scenarioId}?{Http.AsOf}", Http.Json(new
        {
            name = "Tax refund + $80", recurringExtras = new[] { new { amount = 80m } }, lumpSums = new[] { new { amount = 3000m, date = "2027-04-15" } },
        }));
        Assert.Equal("Tax refund + $80", (await updated.ReadJson())["name"]!.GetValue<string>());

        var comparison = await (await _client.GetAsync($"/api/loans/{id}/comparison?budget=700&{Http.AsOf}")).ReadJson();
        var keys = comparison["rows"]!.AsArray().Select(r => r!["key"]!.GetValue<string>()).ToList();
        Assert.Equal("baseline", keys[0]);
        Assert.Contains($"scenario:{scenarioId}", keys);
        Assert.Equal($"scenario:{scenarioId}", comparison["best"]!["lowestInterest"]!.GetValue<string>());

        var insights = await (await _client.GetAsync($"/api/loans/{id}/insights?{Http.AsOf}")).ReadJson();
        Assert.Contains(insights.AsArray(), i => i!["category"]!.GetValue<string>() == "scenario");

        var schedule = await (await _client.GetAsync($"/api/loans/{id}/schedule?scenarioId={scenarioId}&{Http.AsOf}")).ReadJson();
        Assert.Empty(schedule["history"]!.AsArray());
        Assert.Equal("projectionStart", schedule["cumulativeInterestFrom"]!.GetValue<string>());
        Assert.True(schedule["scenario"]!["rows"]!.AsArray().Count < schedule["baseline"]!["rows"]!.AsArray().Count);
        Assert.NotEmpty(schedule["scenarioAnnual"]!.AsArray());

        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/loans/{id}/schedule?scenarioId=999")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/loans/{id}/scenarios/{scenarioId}")).StatusCode);
        Assert.Empty((await (await _client.GetAsync($"/api/loans/{id}/scenarios")).ReadJson()).AsArray());
    }

    [Fact]
    public async Task Export_CsvAndXlsx()
    {
        var id = await _client.CreateLoan();
        var csv = await _client.PostAsync($"/api/loans/{id}/export?format=csv&{Http.AsOf}",
            Http.Json(new { scenario = new { name = "Extra", recurringExtras = new[] { new { amount = 100m } } } }));
        Assert.Equal(HttpStatusCode.OK, csv.StatusCode);
        Assert.Equal("2023-honda-cr-v-extra.csv", csv.Content.Headers.ContentDisposition!.FileNameStar ?? csv.Content.Headers.ContentDisposition.FileName);
        var lines = (await csv.Content.ReadAsStringAsync()).TrimStart('﻿').Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.StartsWith("Payment #,Date,Type,Starting balance", lines[0]);
        Assert.StartsWith("31,2026-10-10,Payment,21480.55,", lines[1]);

        var annual = await _client.PostAsync($"/api/loans/{id}/export?format=csv&view=annual&{Http.AsOf}", Http.Json(new { }));
        Assert.StartsWith("Year,Payments", (await annual.Content.ReadAsStringAsync()).TrimStart('﻿'));

        var xlsx = await _client.PostAsync($"/api/loans/{id}/export?format=xlsx&{Http.AsOf}",
            Http.Json(new { scenario = new { name = "Extra / $100?", recurringExtras = new[] { new { amount = 100m } } } }));
        Assert.Equal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsx.Content.Headers.ContentType!.MediaType);
        using var zip = new ZipArchive(await xlsx.Content.ReadAsStreamAsync());
        var workbook = XDocument.Load(zip.GetEntry("xl/workbook.xml")!.Open());
        XNamespace ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
        Assert.Equal(["Summary", "Baseline schedule", "Baseline by year", "Extra - $100-", "Extra - $100- by year"],
            workbook.Descendants(ns + "sheet").Select(s => s.Attribute("name")!.Value));
        foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".xml", StringComparison.Ordinal) || e.FullName.EndsWith(".rels", StringComparison.Ordinal)))
        {
            XDocument.Load(entry.Open()); // every part is well-formed XML
        }

        var bad = await _client.PostAsync($"/api/loans/{id}/export?format=pdf", Http.Json(new { }));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Refinance_ReturnsComparison()
    {
        var id = await _client.CreateLoan();
        var json = await (await _client.PostAsync($"/api/loans/{id}/refinance?{Http.AsOf}",
            Http.Json(new { newAprPercent = 4.25m, newTermMonths = 48, fees = 250m, feesFinanced = false }))).ReadJson();
        Assert.True(json["lifetimeSavings"]!.GetValue<decimal>() > 0m);
        Assert.NotNull(json["breakEvenMonth"]);
        Assert.NotEmpty(json["rateComparison"]!.AsArray());

        var bad = await _client.PostAsync($"/api/loans/{id}/refinance", Http.Json(new { newAprPercent = -1m, newTermMonths = 48, fees = 0m, feesFinanced = false }));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }

    [Fact]
    public async Task Payments_AddImportTrackDelete()
    {
        var id = await _client.CreateLoan();
        var created = await _client.PostAsync($"/api/loans/{id}/payments?{Http.AsOf}",
            Http.Json(new { date = "2024-04-10", amount = 537.77m, principal = 367.61m, interest = 170.16m }));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var paymentId = (await created.ReadJson())["id"]!.GetValue<long>();

        var future = await _client.PostAsync($"/api/loans/{id}/payments?{Http.AsOf}", Http.Json(new { date = "2030-01-01", amount = 10m }));
        Assert.Equal(HttpStatusCode.BadRequest, future.StatusCode);

        var import = await _client.PostAsync($"/api/loans/{id}/payments/import?{Http.AsOf}",
            new StringContent("date,amount\n2024-05-10,537.77\n06/10/2024,\"$1,037.77\"\nbad,1\n2031-01-01,5\n", Encoding.UTF8, "text/csv"));
        var result = await import.ReadJson();
        Assert.Equal(2, result["imported"]!.GetValue<int>());
        Assert.Equal([4, 5], result["errors"]!.AsArray().Select(e => e!["line"]!.GetValue<int>()));

        // Importing the same statement again skips the duplicates instead of doubling the history.
        var again = await (await _client.PostAsync($"/api/loans/{id}/payments/import?{Http.AsOf}",
            new StringContent("date,amount\n2024-05-10,537.77\n2024-05-10,537.77\n2024-07-10,537.77\n", Encoding.UTF8, "text/csv"))).ReadJson();
        Assert.Equal(1, again["imported"]!.GetValue<int>());
        Assert.Equal(2, again["skipped"]!.GetValue<int>());
        Assert.Equal([2, 3], again["errors"]!.AsArray().Select(e => e!["line"]!.GetValue<int>()));

        var notCsv = await _client.PostAsync($"/api/loans/{id}/payments/import", new StringContent("date,amount\n2024-08-10,1", Encoding.UTF8, "text/plain"));
        Assert.Equal(HttpStatusCode.BadRequest, notCsv.StatusCode);

        Assert.Equal(4, (await (await _client.GetAsync($"/api/loans/{id}/payments")).ReadJson()).AsArray().Count);
        var tracking = await (await _client.GetAsync($"/api/loans/{id}/payments/tracking?{Http.AsOf}")).ReadJson();
        Assert.Equal(537.77m + 537.77m + 1037.77m + 537.77m, tracking["totalActual"]!.GetValue<decimal>());

        var dashboard = await (await _client.GetAsync($"/api/loans/{id}/dashboard?{Http.AsOf}")).ReadJson();
        // Only one of the 30 payments made has an interest split, so interest history stays unknown (never invented).
        Assert.Equal("unknown", dashboard["status"]!["interestPaidSource"]!.GetValue<string>());

        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/loans/{id}/payments/{paymentId}")).StatusCode);
    }

    [Fact]
    public async Task Preferences_RoundTripAndValidate()
    {
        var id = await _client.CreateLoan();
        var saved = await (await _client.PutAsync("/api/preferences", Http.Json(new
        {
            theme = "dark", currency = "EUR", defaultAccrualMethod = "dailySimple", selectedLoanId = id, comparisonBudget = 650m,
        }))).ReadJson();
        Assert.Equal("dark", saved["theme"]!.GetValue<string>());
        Assert.Equal(id, saved["selectedLoanId"]!.GetValue<long>());

        var insights = await (await _client.GetAsync($"/api/loans/{id}/insights?{Http.AsOf}")).ReadJson();
        Assert.Contains("€", insights[0]!["message"]!.GetValue<string>() + insights[1]!["explanation"]!.GetValue<string>());

        var bad = await _client.PutAsync("/api/preferences", Http.Json(new { theme = "neon", currency = "BTC", defaultAccrualMethod = "monthly", selectedLoanId = 999 }));
        Assert.Equal(["theme", "currency", "selectedLoanId"], (await bad.ReadJson())["errors"]!.AsObject().Select(e => e.Key));

        await _client.DeleteAsync($"/api/loans/{id}");
        Assert.Null((await (await _client.GetAsync("/api/preferences")).ReadJson())["selectedLoanId"]);
    }

    [Fact]
    public async Task Data_PersistsAcrossRestart()
    {
        var directory = Path.Combine(Path.GetTempPath(), "loanpilot-api-tests", Guid.NewGuid().ToString("N"));
        try
        {
            using (var first = new ApiFactory(directory))
            using (var client = first.CreateClient())
            {
                await client.CreateLoan();
            }

            using var second = new ApiFactory(directory);
            using var client2 = second.CreateClient();
            var loans = await (await client2.GetAsync("/api/loans")).ReadJson();
            Assert.Equal("2023 Honda CR-V", loans[0]!["loan"]!["name"]!.GetValue<string>());
            Assert.True(File.Exists(Path.Combine(directory, "loanpilot.db")));
        }
        finally
        {
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            try { Directory.Delete(directory, true); } catch (IOException) { }
        }
    }
}
