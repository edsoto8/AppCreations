using Dapper;
using LoanPilot.Core.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Repositories;

public sealed class LoanRepository(LoanPilotDatabase database, ILogger<LoanRepository> logger, TimeProvider? timeProvider = null)
    : RepositoryBase(database, timeProvider, logger)
{
    private const string Columns =
        """
        id, name, vehicle_make, vehicle_model, vehicle_year, lender,
        original_amount, down_payment, apr_percent, term_months, start_date, first_payment_date,
        scheduled_payment, payment_frequency, accrual_method, day_count_basis,
        current_balance, balance_as_of, payments_made, interest_paid_to_date,
        vehicle_value, notes, is_archived, created_at, updated_at
        """;

    /// <summary>Active loans first, then archived ones (when requested), each group by name.</summary>
    public IReadOnlyList<Loan> List(bool includeArchived) => Read("load loans", c =>
        c.Query<Loan>(
            $"""
            SELECT {Columns} FROM loans
            WHERE @includeArchived = 1 OR is_archived = 0
            ORDER BY is_archived, name COLLATE NOCASE, id
            """,
            new { includeArchived }).AsList());

    public Loan? Get(long id) => Read("load the loan", c => Load(c, null, id));

    /// <summary>Saves a new loan. <see cref="Loan.Id"/> and the timestamps on <paramref name="loan"/> are ignored.</summary>
    public Loan Insert(Loan loan)
    {
        ArgumentNullException.ThrowIfNull(loan);

        return Write("save the loan", (c, t) =>
        {
            var now = UtcNow();
            var id = c.ExecuteScalar<long>(
                """
                INSERT INTO loans (
                    name, vehicle_make, vehicle_model, vehicle_year, lender,
                    original_amount, down_payment, apr_percent, term_months, start_date, first_payment_date,
                    scheduled_payment, payment_frequency, accrual_method, day_count_basis,
                    current_balance, balance_as_of, payments_made, interest_paid_to_date,
                    vehicle_value, notes, is_archived, created_at, updated_at)
                VALUES (
                    @Name, @VehicleMake, @VehicleModel, @VehicleYear, @Lender,
                    @OriginalAmount, @DownPayment, @AprPercent, @TermMonths, @StartDate, @FirstPaymentDate,
                    @ScheduledPayment, @PaymentFrequency, @AccrualMethod, @DayCountBasis,
                    @CurrentBalance, @BalanceAsOf, @PaymentsMade, @InterestPaidToDate,
                    @VehicleValue, @Notes, @IsArchived, @now, @now)
                RETURNING id
                """,
                Parameters(loan, now), t);
            return Load(c, t, id)!;
        });
    }

    /// <summary>
    /// Replaces every editable field of the loan with the given id. <see cref="Loan.CreatedAt"/> and
    /// <see cref="Loan.IsArchived"/> are kept (use <see cref="SetArchived"/> to archive). Returns null when
    /// the loan does not exist.
    /// </summary>
    public Loan? Update(Loan loan)
    {
        ArgumentNullException.ThrowIfNull(loan);

        return Write("save the loan", (c, t) =>
        {
            var changed = c.Execute(
                """
                UPDATE loans SET
                    name = @Name, vehicle_make = @VehicleMake, vehicle_model = @VehicleModel,
                    vehicle_year = @VehicleYear, lender = @Lender,
                    original_amount = @OriginalAmount, down_payment = @DownPayment, apr_percent = @AprPercent,
                    term_months = @TermMonths, start_date = @StartDate, first_payment_date = @FirstPaymentDate,
                    scheduled_payment = @ScheduledPayment, payment_frequency = @PaymentFrequency,
                    accrual_method = @AccrualMethod, day_count_basis = @DayCountBasis,
                    current_balance = @CurrentBalance, balance_as_of = @BalanceAsOf,
                    payments_made = @PaymentsMade, interest_paid_to_date = @InterestPaidToDate,
                    vehicle_value = @VehicleValue, notes = @Notes, updated_at = @now
                WHERE id = @Id
                """,
                Parameters(loan, UtcNow()), t);
            return changed == 0 ? null : Load(c, t, loan.Id);
        });
    }

    public Loan? SetArchived(long id, bool archived) => Write("update the loan", (c, t) =>
    {
        var changed = c.Execute(
            "UPDATE loans SET is_archived = @archived, updated_at = @now WHERE id = @id",
            new { id, archived, now = UtcNow() }, t);
        return changed == 0 ? null : Load(c, t, id);
    });

    /// <summary>Deletes the loan and, by cascade, its scenarios (with their extras and lump sums) and payment records.</summary>
    public bool Delete(long id) => Write("delete the loan", (c, t) =>
        c.Execute("DELETE FROM loans WHERE id = @id", new { id }, t) > 0);

    private static Loan? Load(SqliteConnection connection, SqliteTransaction? transaction, long id) =>
        connection.QuerySingleOrDefault<Loan>($"SELECT {Columns} FROM loans WHERE id = @id", new { id }, transaction);

    /// <summary>Enums are passed as their names: Dapper would otherwise send the underlying integer.</summary>
    private static object Parameters(Loan loan, DateTime now) => new
    {
        loan.Id,
        loan.Name,
        loan.VehicleMake,
        loan.VehicleModel,
        loan.VehicleYear,
        loan.Lender,
        loan.OriginalAmount,
        loan.DownPayment,
        loan.AprPercent,
        loan.TermMonths,
        loan.StartDate,
        loan.FirstPaymentDate,
        loan.ScheduledPayment,
        PaymentFrequency = loan.PaymentFrequency.ToString(),
        AccrualMethod = loan.AccrualMethod.ToString(),
        DayCountBasis = loan.DayCountBasis.ToString(),
        loan.CurrentBalance,
        loan.BalanceAsOf,
        loan.PaymentsMade,
        loan.InterestPaidToDate,
        loan.VehicleValue,
        loan.Notes,
        loan.IsArchived,
        now,
    };
}
