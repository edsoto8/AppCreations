namespace LoanPilot.Data.Schema;

/// <summary>
/// The ordered schema history. Never edit a released migration; append a new one with the next version.
/// Money and rates are TEXT (invariant-culture decimals) so they round-trip exactly; dates are
/// <c>yyyy-MM-dd</c> text and timestamps ISO-8601 UTC text.
/// </summary>
public static class Migrations
{
    public static IReadOnlyList<Migration> All { get; } =
    [
        new(1, "Initial schema", """
            CREATE TABLE loans (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                name                  TEXT    NOT NULL,
                vehicle_make          TEXT    NULL,
                vehicle_model         TEXT    NULL,
                vehicle_year          INTEGER NULL,
                lender                TEXT    NULL,
                original_amount       TEXT    NOT NULL,
                down_payment          TEXT    NULL,
                apr_percent           TEXT    NOT NULL,
                term_months           INTEGER NOT NULL,
                start_date            TEXT    NOT NULL,
                first_payment_date    TEXT    NOT NULL,
                scheduled_payment     TEXT    NULL,
                payment_frequency     TEXT    NOT NULL DEFAULT 'Monthly'
                                      CHECK (payment_frequency IN ('Monthly', 'Biweekly', 'Weekly')),
                accrual_method        TEXT    NOT NULL DEFAULT 'Monthly'
                                      CHECK (accrual_method IN ('Monthly', 'DailySimple')),
                day_count_basis       TEXT    NOT NULL DEFAULT 'Actual365'
                                      CHECK (day_count_basis IN ('Actual365', 'ActualActual')),
                current_balance       TEXT    NULL,
                balance_as_of         TEXT    NULL,
                payments_made         INTEGER NULL,
                interest_paid_to_date TEXT    NULL,
                vehicle_value         TEXT    NULL,
                notes                 TEXT    NULL,
                is_archived           INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
                created_at            TEXT    NOT NULL,
                updated_at            TEXT    NOT NULL
            );
            CREATE INDEX ix_loans_archived_name ON loans(is_archived, name COLLATE NOCASE);

            CREATE TABLE scenarios (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                loan_id        INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
                name           TEXT    NOT NULL,
                description    TEXT    NULL,
                budget_payment TEXT    NULL,
                created_at     TEXT    NOT NULL,
                updated_at     TEXT    NOT NULL
            );
            CREATE INDEX ix_scenarios_loan_id ON scenarios(loan_id, created_at, id);

            CREATE TABLE scenario_recurring_extras (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
                sort_order  INTEGER NOT NULL,
                amount      TEXT    NOT NULL,
                start_date  TEXT    NULL,
                end_date    TEXT    NULL
            );
            CREATE INDEX ix_scenario_recurring_extras_scenario_id
                ON scenario_recurring_extras(scenario_id, sort_order);

            CREATE TABLE scenario_lump_sums (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
                sort_order  INTEGER NOT NULL,
                amount      TEXT    NOT NULL,
                date        TEXT    NOT NULL,
                note        TEXT    NULL
            );
            CREATE INDEX ix_scenario_lump_sums_scenario_id
                ON scenario_lump_sums(scenario_id, sort_order);

            CREATE TABLE payment_records (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                loan_id    INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
                date       TEXT    NOT NULL,
                amount     TEXT    NOT NULL,
                principal  TEXT    NULL,
                interest   TEXT    NULL,
                note       TEXT    NULL,
                created_at TEXT    NOT NULL
            );
            CREATE INDEX ix_payment_records_loan_id ON payment_records(loan_id, date, id);

            CREATE TABLE preferences (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            ) WITHOUT ROWID;
            """),
    ];

    public static int LatestVersion => All[^1].Version;
}
