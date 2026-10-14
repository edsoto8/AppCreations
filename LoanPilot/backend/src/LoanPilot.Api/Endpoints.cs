using LoanPilot.Api.Export;
using LoanPilot.Core.Domain;
using LoanPilot.Core.Engine;

namespace LoanPilot.Api;

public static class Endpoints
{
    private const int MaxImportBytes = 1_000_000;

    public static void MapLoanPilotApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");
        api.MapGet("/health", () => Results.Ok(new { status = "ok" }));

        MapLoans(api);
        MapCalculations(api);
        MapScenarios(api);
        MapPayments(api);
        MapPreferences(api);
        api.MapFallback(() => Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Not found"));
    }

    private static IResult LoanNotFound() =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Loan not found",
            detail: "The loan does not exist or was deleted.");

    private static void MapLoans(RouteGroupBuilder api)
    {
        api.MapGet("/loans", (bool? includeArchived, LoanWorkspace ws) =>
            ws.Loans.List(includeArchived ?? false).Select(loan => ListItem(ws, loan)).ToList());

        api.MapGet("/loans/{id:long}", (long id, LoanWorkspace ws) =>
            ws.Loans.Get(id) is { } loan ? Results.Ok(loan) : LoanNotFound());

        api.MapPost("/loans", (LoanInput input, LoanWorkspace ws, ILogger<LoanWorkspace> log) =>
        {
            var saved = ws.Loans.Insert(input.ToLoan(ws.Today));
            log.LogInformation("Created loan {LoanId}", saved.Id);
            return Results.Created($"/api/loans/{saved.Id}", saved);
        });

        api.MapPut("/loans/{id:long}", (long id, LoanInput input, LoanWorkspace ws) =>
        {
            if (ws.Loans.Get(id) is null)
            {
                return LoanNotFound();
            }

            return ws.Loans.Update(input.ToLoan(ws.Today, id)) is { } updated ? Results.Ok(updated) : LoanNotFound();
        });

        api.MapPost("/loans/{id:long}/archive", (long id, LoanWorkspace ws) =>
            ws.Loans.SetArchived(id, true) is { } loan ? Results.Ok(loan) : LoanNotFound());

        api.MapPost("/loans/{id:long}/unarchive", (long id, LoanWorkspace ws) =>
            ws.Loans.SetArchived(id, false) is { } loan ? Results.Ok(loan) : LoanNotFound());

        api.MapDelete("/loans/{id:long}", (long id, LoanWorkspace ws, ILogger<LoanWorkspace> log) =>
        {
            if (!ws.Loans.Delete(id))
            {
                return LoanNotFound();
            }

            var prefs = ws.Preferences.Get();
            if (prefs.SelectedLoanId == id)
            {
                prefs.SelectedLoanId = null;
                ws.Preferences.Save(prefs);
            }

            log.LogInformation("Deleted loan {LoanId}", id);
            return Results.NoContent();
        });
    }

    private static LoanListItem ListItem(LoanWorkspace ws, Loan loan)
    {
        try
        {
            var s = ws.Analyze(loan).Status;
            return new LoanListItem(loan, s.CurrentBalance, s.PercentRepaid, s.ScheduledPayment, s.PayoffDate, s.IsPaidOff);
        }
        catch (LoanValidationException)
        {
            // A saved loan that no longer validates (for example with an asOf override) still lists.
            return new LoanListItem(loan, loan.CurrentBalance ?? loan.OriginalAmount, 0m, loan.ScheduledPayment ?? 0m, null, false);
        }
    }

    private static void MapCalculations(RouteGroupBuilder api)
    {
        api.MapPost("/calculate/preview", (LoanInput input, LoanWorkspace ws) =>
        {
            var analysis = ws.Analyze(input.ToLoan(ws.Today));
            return new PreviewResult(analysis.Status, analysis.Baseline.Summary);
        });

        api.MapGet("/loans/{id:long}/dashboard", (long id, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            var insights = InsightsEngine.Generate(analysis, ws.Scenarios.ListForLoan(id))
                .Where(i => i.Category != InsightCategory.Warning).Take(4).ToList();
            return Results.Ok(new Dashboard(analysis.Loan, analysis.Status, analysis.Baseline, SavingsOptions(analysis), insights));
        });

        api.MapPost("/loans/{id:long}/simulate", (long id, ScenarioInput input, LoanWorkspace ws) =>
            ws.Analyze(id) is { } analysis ? Results.Ok(Simulator.Simulate(analysis, input.ToScenario(id))) : LoanNotFound());

        api.MapPost("/loans/{id:long}/target-payoff", (long id, TargetPayoffRequest input, LoanWorkspace ws) =>
        {
            if (input.TargetDate is not { } target)
            {
                throw new LoanValidationException([new ValidationError("targetDate", "Choose the date you want to be paid off by.")]);
            }

            return ws.Analyze(id) is { } analysis ? Results.Ok(Simulator.TargetPayoff(analysis, target)) : LoanNotFound();
        });

        api.MapPost("/loans/{id:long}/budget", (long id, BudgetRequest input, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            if (input.Budget is not { } budget)
            {
                throw new LoanValidationException([new ValidationError("budget", "Enter how much you can pay each month.")]);
            }

            try
            {
                return Results.Ok(Simulator.Budget(analysis, budget));
            }
            catch (LoanValidationException ex)
            {
                // The scenario field is budgetPayment; this endpoint's field is budget.
                throw new LoanValidationException(ex.Errors.Select(e => e.Field == "budgetPayment" ? e with { Field = "budget" } : e).ToList());
            }
        });

        api.MapGet("/loans/{id:long}/comparison", (long id, decimal? budget, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            var limit = budget ?? ws.Preferences.Get().ComparisonBudget;
            return Results.Ok(ScenarioComparer.Compare(analysis, ws.Scenarios.ListForLoan(id), limit));
        });

        api.MapGet("/loans/{id:long}/insights", (long id, LoanWorkspace ws) =>
            ws.Analyze(id) is { } analysis
                ? Results.Ok(InsightsEngine.Generate(analysis, ws.Scenarios.ListForLoan(id)))
                : LoanNotFound());

        api.MapGet("/loans/{id:long}/schedule", (long id, long? scenarioId, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            Scenario? scenario = null;
            if (scenarioId is { } sid && (scenario = ws.Scenarios.Get(id, sid)) is null)
            {
                return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Scenario not found");
            }

            return Results.Ok(Schedule(analysis, scenario));
        });

        api.MapPost("/loans/{id:long}/schedule", (long id, ScenarioInput input, LoanWorkspace ws) =>
            ws.Analyze(id) is { } analysis ? Results.Ok(Schedule(analysis, input.ToScenario(id))) : LoanNotFound());

        api.MapPost("/loans/{id:long}/export", (long id, string? format, string? view, ExportRequest? body, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            Scenario? scenario = null;
            if (body?.ScenarioId is { } sid)
            {
                scenario = ws.Scenarios.Get(id, sid);
                if (scenario is null)
                {
                    return Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Scenario not found");
                }
            }
            else if (body?.Scenario is { } inline)
            {
                scenario = inline.ToScenario(id);
                if (string.IsNullOrWhiteSpace(scenario.Name))
                {
                    scenario.Name = "Scenario";
                }
            }

            var schedule = Schedule(analysis, scenario);
            var annual = string.Equals(view, "annual", StringComparison.OrdinalIgnoreCase);
            var baseName = ScheduleExport.FileBaseName(analysis.Loan, scenario, annual);
            return (format ?? "csv").ToLowerInvariant() switch
            {
                "csv" => Results.File(ScheduleExport.Csv(analysis, schedule, scenario, annual), "text/csv; charset=utf-8", baseName + ".csv"),
                "xlsx" => Results.File(ScheduleExport.Xlsx(analysis, schedule, scenario),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", baseName + ".xlsx"),
                _ => throw new LoanValidationException([new ValidationError("format", "Choose csv or xlsx.")]),
            };
        });

        api.MapPost("/loans/{id:long}/refinance", (long id, RefinanceInput input, LoanWorkspace ws) =>
            ws.Analyze(id) is { } analysis ? Results.Ok(RefinanceCalculator.Compare(analysis, input)) : LoanNotFound());
    }

    /// <summary>Validates an unsaved or saved scenario and builds the full schedule response.</summary>
    public static ScheduleResponse Schedule(LoanAnalysis analysis, Scenario? scenario)
    {
        Projection? projection = null;
        if (scenario is not null)
        {
            projection = Simulator.Simulate(analysis, scenario).Scenario;
        }

        return new ScheduleResponse(
            analysis.History,
            analysis.Baseline,
            projection,
            ScheduleSummaries.Annual(analysis.History.Concat(analysis.Baseline.Rows)),
            projection is null ? null : ScheduleSummaries.Annual(analysis.History.Concat(projection.Rows)),
            analysis.CumulativeInterestFromOrigination ? "origination" : "projectionStart");
    }

    private static List<DashboardSavingsOption> SavingsOptions(LoanAnalysis analysis)
    {
        var options = new List<DashboardSavingsOption>();
        if (analysis.Status.IsPaidOff || !analysis.Baseline.Summary.PaysOff)
        {
            return options;
        }

        var f = analysis.Format;
        var per = analysis.Loan.PaymentFrequency == PaymentFrequency.Monthly ? "mo" : "payment";
        foreach (var extra in new[] { 50m, 100m, 250m })
        {
            var c = Simulator.Compare(analysis.Baseline, analysis.Project(new Scenario { RecurringExtras = [new RecurringExtra(extra)] }));
            options.Add(new DashboardSavingsOption($"+{f.WholeMoney(extra)}/{per}", extra, 0m, c.InterestSaved, c.MonthsSaved, c.NewPayoffDate));
        }

        var lump = ScenarioComparer.SuggestedLumpSum(analysis.Status.CurrentBalance);
        if (lump > 0m)
        {
            var c = Simulator.Compare(analysis.Baseline,
                analysis.Project(new Scenario { LumpSums = [new LumpSum(lump, analysis.EffectiveToday)] }));
            options.Add(new DashboardSavingsOption($"{f.WholeMoney(lump)} lump sum today", 0m, lump, c.InterestSaved, c.MonthsSaved, c.NewPayoffDate));
        }

        var payoff = analysis.Status.PayoffEstimate;
        var basePayoff = analysis.Baseline.Summary.PayoffDate;
        options.Add(new DashboardSavingsOption("Pay off today", 0m, payoff.Total,
            LoanAnalyzer.InterestAvoidedByPayoff(analysis),
            basePayoff is { } d ? Math.Max(0, PaymentCalendar.MonthsBetween(payoff.Date, d)) : 0, payoff.Date));
        return options;
    }

    private static void MapScenarios(RouteGroupBuilder api)
    {
        api.MapGet("/loans/{id:long}/scenarios", (long id, LoanWorkspace ws) =>
            ws.Loans.Get(id) is null ? LoanNotFound() : Results.Ok(ws.Scenarios.ListForLoan(id)));

        api.MapPost("/loans/{id:long}/scenarios", (long id, ScenarioInput input, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            var scenario = ValidatedForSave(analysis, input.ToScenario(id));
            var saved = ws.Scenarios.Insert(scenario);
            return Results.Created($"/api/loans/{id}/scenarios/{saved.Id}", saved);
        });

        api.MapPut("/loans/{id:long}/scenarios/{scenarioId:long}", (long id, long scenarioId, ScenarioInput input, LoanWorkspace ws) =>
        {
            if (ws.Analyze(id) is not { } analysis)
            {
                return LoanNotFound();
            }

            var scenario = ValidatedForSave(analysis, input.ToScenario(id, scenarioId));
            return ws.Scenarios.Update(scenario) is { } updated
                ? Results.Ok(updated)
                : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Scenario not found");
        });

        api.MapDelete("/loans/{id:long}/scenarios/{scenarioId:long}", (long id, long scenarioId, LoanWorkspace ws) =>
            ws.Scenarios.Delete(id, scenarioId)
                ? Results.NoContent()
                : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Scenario not found"));
    }

    private static Scenario ValidatedForSave(LoanAnalysis analysis, Scenario scenario)
    {
        var errors = ScenarioValidator.Validate(scenario, analysis, requireName: true, analysis.Format);
        if (errors.Count > 0)
        {
            throw new LoanValidationException(errors);
        }

        return scenario;
    }

    private static void MapPayments(RouteGroupBuilder api)
    {
        api.MapGet("/loans/{id:long}/payments", (long id, LoanWorkspace ws) =>
            ws.Loans.Get(id) is null ? LoanNotFound() : Results.Ok(ws.Payments.ListForLoan(id)));

        api.MapPost("/loans/{id:long}/payments", (long id, PaymentRecordInput input, LoanWorkspace ws) =>
        {
            if (ws.Loans.Get(id) is not { } loan)
            {
                return LoanNotFound();
            }

            if (input.Date is not { } date)
            {
                throw new LoanValidationException([new ValidationError("date", "Enter the date of the payment.")]);
            }

            var record = new PaymentRecord
            {
                LoanId = id,
                Date = date,
                Amount = Money.Round(input.Amount),
                Principal = input.Principal is { } p ? Money.Round(p) : null,
                Interest = input.Interest is { } i ? Money.Round(i) : null,
                Note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim(),
            };
            var errors = PaymentHistory.Validate(record, loan, ws.Today);
            if (errors.Count > 0)
            {
                throw new LoanValidationException(errors);
            }

            var saved = ws.Payments.Insert(record);
            return Results.Created($"/api/loans/{id}/payments/{saved.Id}", saved);
        });

        api.MapDelete("/loans/{id:long}/payments/{paymentId:long}", (long id, long paymentId, LoanWorkspace ws) =>
            ws.Payments.Delete(id, paymentId)
                ? Results.NoContent()
                : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Payment not found"));

        api.MapPost("/loans/{id:long}/payments/import", async (long id, HttpRequest request, LoanWorkspace ws) =>
        {
            if (ws.Loans.Get(id) is not { } loan)
            {
                return LoanNotFound();
            }

            if (request.ContentLength > MaxImportBytes)
            {
                throw new LoanValidationException([new ValidationError("file", "The file is too large (limit 1 MB).")]);
            }

            using var reader = new StreamReader(request.Body);
            var buffer = new char[MaxImportBytes + 1];
            var read = await reader.ReadBlockAsync(buffer, 0, buffer.Length);
            if (read > MaxImportBytes)
            {
                throw new LoanValidationException([new ValidationError("file", "The file is too large (limit 1 MB).")]);
            }

            var parsed = PaymentHistory.ParseCsv(new string(buffer, 0, read), id);
            var errors = parsed.Errors.ToList();
            var today = ws.Today;
            var valid = new List<PaymentRecord>();
            foreach (var record in parsed.Records)
            {
                var problems = PaymentHistory.Validate(record, loan, today);
                if (problems.Count == 0)
                {
                    valid.Add(record);
                }
                else
                {
                    errors.Add(new ImportError(0, $"{record.Date:yyyy-MM-dd} {record.Amount}: {problems[0].Message}"));
                }
            }

            if (valid.Count > 0)
            {
                ws.Payments.InsertMany(id, valid);
            }

            return Results.Ok(new ImportResult(valid.Count, errors));
        });

        api.MapGet("/loans/{id:long}/payments/tracking", (long id, LoanWorkspace ws) =>
            ws.Analyze(id) is { } analysis
                ? Results.Ok(PaymentHistory.Track(analysis, ws.Payments.ListForLoan(id)))
                : LoanNotFound());
    }

    private static readonly string[] Themes = ["system", "light", "dark"];
    private static readonly string[] Currencies = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN"];

    private static void MapPreferences(RouteGroupBuilder api)
    {
        api.MapGet("/preferences", (LoanWorkspace ws) => ws.Preferences.Get());

        api.MapPut("/preferences", (UserPreferences input, LoanWorkspace ws) =>
        {
            var errors = new List<ValidationError>();
            if (!Themes.Contains(input.Theme))
            {
                errors.Add(new ValidationError("theme", "Choose system, light or dark."));
            }

            if (!Currencies.Contains(input.Currency))
            {
                errors.Add(new ValidationError("currency", $"Choose one of {string.Join(", ", Currencies)}."));
            }

            if (!Enum.IsDefined(input.DefaultAccrualMethod))
            {
                errors.Add(new ValidationError("defaultAccrualMethod", "Choose an accrual method."));
            }

            if (input.ComparisonBudget is < 0m)
            {
                errors.Add(new ValidationError("comparisonBudget", "The budget cannot be negative."));
            }

            if (input.SelectedLoanId is { } selected && ws.Loans.Get(selected) is null)
            {
                errors.Add(new ValidationError("selectedLoanId", "That loan does not exist."));
            }

            if (errors.Count > 0)
            {
                throw new LoanValidationException(errors);
            }

            ws.Preferences.Save(input);
            return ws.Preferences.Get();
        });
    }
}
