using Dapper;
using LoanPilot.Core.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Repositories;

public sealed class ScenarioRepository(LoanPilotDatabase database, ILogger<ScenarioRepository> logger, TimeProvider? timeProvider = null)
    : RepositoryBase(database, timeProvider, logger)
{
    /// <summary>The loan's scenarios oldest first, each with its recurring extras and lump sums in saved order.</summary>
    public IReadOnlyList<Scenario> ListForLoan(long loanId) =>
        ReadSnapshot("load scenarios", (c, t) => Load(c, t, loanId, null));

    public Scenario? Get(long loanId, long scenarioId) =>
        ReadSnapshot("load the scenario", (c, t) => Load(c, t, loanId, scenarioId).SingleOrDefault());

    /// <summary>
    /// Saves a new scenario under <see cref="Scenario.LoanId"/>. A loan that does not exist fails with a
    /// <see cref="PersistenceException"/> (foreign key).
    /// </summary>
    public Scenario Insert(Scenario scenario)
    {
        ArgumentNullException.ThrowIfNull(scenario);

        return Write("save the scenario", (c, t) =>
        {
            var now = UtcNow();
            var id = c.ExecuteScalar<long>(
                """
                INSERT INTO scenarios (loan_id, name, description, budget_payment, created_at, updated_at)
                VALUES (@LoanId, @Name, @Description, @BudgetPayment, @now, @now)
                RETURNING id
                """,
                new { scenario.LoanId, scenario.Name, scenario.Description, scenario.BudgetPayment, now }, t);
            InsertChildren(c, t, id, scenario);
            return Load(c, t, scenario.LoanId, id).Single();
        });
    }

    /// <summary>
    /// Replaces the scenario's fields and its extras and lump sums in one transaction. The scenario is
    /// matched on both <see cref="Scenario.Id"/> and <see cref="Scenario.LoanId"/>; null when there is none.
    /// </summary>
    public Scenario? Update(Scenario scenario)
    {
        ArgumentNullException.ThrowIfNull(scenario);

        return Write("save the scenario", (c, t) =>
        {
            var changed = c.Execute(
                """
                UPDATE scenarios
                SET name = @Name, description = @Description, budget_payment = @BudgetPayment, updated_at = @now
                WHERE id = @Id AND loan_id = @LoanId
                """,
                new { scenario.Id, scenario.LoanId, scenario.Name, scenario.Description, scenario.BudgetPayment, now = UtcNow() }, t);
            if (changed == 0)
            {
                return null;
            }

            var parameters = new { scenarioId = scenario.Id };
            c.Execute("DELETE FROM scenario_recurring_extras WHERE scenario_id = @scenarioId", parameters, t);
            c.Execute("DELETE FROM scenario_lump_sums WHERE scenario_id = @scenarioId", parameters, t);
            InsertChildren(c, t, scenario.Id, scenario);
            return Load(c, t, scenario.LoanId, scenario.Id).Single();
        });
    }

    /// <summary>Deletes the scenario and, by cascade, its extras and lump sums.</summary>
    public bool Delete(long loanId, long scenarioId) => Write("delete the scenario", (c, t) =>
        c.Execute(
            "DELETE FROM scenarios WHERE id = @scenarioId AND loan_id = @loanId",
            new { loanId, scenarioId }, t) > 0);

    private static void InsertChildren(SqliteConnection c, SqliteTransaction t, long scenarioId, Scenario scenario)
    {
        c.Execute(
            """
            INSERT INTO scenario_recurring_extras (scenario_id, sort_order, amount, start_date, end_date)
            VALUES (@scenarioId, @sortOrder, @Amount, @StartDate, @EndDate)
            """,
            scenario.RecurringExtras.Select((e, i) => new { scenarioId, sortOrder = i, e.Amount, e.StartDate, e.EndDate }),
            t);
        c.Execute(
            """
            INSERT INTO scenario_lump_sums (scenario_id, sort_order, amount, date, note)
            VALUES (@scenarioId, @sortOrder, @Amount, @Date, @Note)
            """,
            scenario.LumpSums.Select((l, i) => new { scenarioId, sortOrder = i, l.Amount, l.Date, l.Note }),
            t);
    }

    /// <summary>Three queries (scenarios, extras, lump sums) regardless of how many scenarios match.</summary>
    private static List<Scenario> Load(SqliteConnection c, SqliteTransaction t, long loanId, long? scenarioId)
    {
        var parameters = new { loanId, scenarioId };

        var scenarios = c.Query<Scenario>(
            """
            SELECT id, loan_id, name, description, budget_payment, created_at, updated_at
            FROM scenarios
            WHERE loan_id = @loanId AND (@scenarioId IS NULL OR id = @scenarioId)
            ORDER BY created_at, id
            """,
            parameters, t).AsList();
        if (scenarios.Count == 0)
        {
            return scenarios;
        }

        var byId = scenarios.ToDictionary(s => s.Id);

        var extras = c.Query<ExtraRow>(
            """
            SELECT e.scenario_id, e.amount, e.start_date, e.end_date
            FROM scenario_recurring_extras e
            JOIN scenarios s ON s.id = e.scenario_id
            WHERE s.loan_id = @loanId AND (@scenarioId IS NULL OR s.id = @scenarioId)
            ORDER BY e.scenario_id, e.sort_order, e.id
            """,
            parameters, t);
        foreach (var row in extras)
        {
            byId[row.ScenarioId].RecurringExtras.Add(new RecurringExtra(row.Amount, row.StartDate, row.EndDate));
        }

        var lumpSums = c.Query<LumpSumRow>(
            """
            SELECT l.scenario_id, l.amount, l.date, l.note
            FROM scenario_lump_sums l
            JOIN scenarios s ON s.id = l.scenario_id
            WHERE s.loan_id = @loanId AND (@scenarioId IS NULL OR s.id = @scenarioId)
            ORDER BY l.scenario_id, l.sort_order, l.id
            """,
            parameters, t);
        foreach (var row in lumpSums)
        {
            byId[row.ScenarioId].LumpSums.Add(new LumpSum(row.Amount, row.Date, row.Note));
        }

        return scenarios;
    }

    private sealed class ExtraRow
    {
        public long ScenarioId { get; set; }
        public decimal Amount { get; set; }
        public DateOnly? StartDate { get; set; }
        public DateOnly? EndDate { get; set; }
    }

    private sealed class LumpSumRow
    {
        public long ScenarioId { get; set; }
        public decimal Amount { get; set; }
        public DateOnly Date { get; set; }
        public string? Note { get; set; }
    }
}
