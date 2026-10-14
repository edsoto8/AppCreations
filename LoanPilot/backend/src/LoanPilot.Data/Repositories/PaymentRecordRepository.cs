using Dapper;
using LoanPilot.Core.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Repositories;

public sealed class PaymentRecordRepository(LoanPilotDatabase database, ILogger<PaymentRecordRepository> logger, TimeProvider? timeProvider = null)
    : RepositoryBase(database, timeProvider, logger)
{
    private const string Columns = "id, loan_id, date, amount, principal, interest, note, created_at";

    /// <summary>The loan's payments oldest first (by date, then by insertion order).</summary>
    public IReadOnlyList<PaymentRecord> ListForLoan(long loanId) => Read("load payments", c =>
        c.Query<PaymentRecord>(
            $"SELECT {Columns} FROM payment_records WHERE loan_id = @loanId ORDER BY date, id",
            new { loanId }).AsList());

    /// <summary>
    /// Saves a payment under <see cref="PaymentRecord.LoanId"/>. A loan that does not exist fails with a
    /// <see cref="PersistenceException"/> (foreign key). The id and creation time on the input are ignored.
    /// </summary>
    public PaymentRecord Insert(PaymentRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);

        return Write("save the payment", (c, t) => InsertRow(c, t, record.LoanId, record, UtcNow()));
    }

    /// <summary>Saves all payments for one loan in a single transaction: either every row is stored or none.</summary>
    public IReadOnlyList<PaymentRecord> InsertMany(long loanId, IReadOnlyList<PaymentRecord> records)
    {
        ArgumentNullException.ThrowIfNull(records);

        return Write("save the payments", (c, t) =>
        {
            var now = UtcNow();
            return (IReadOnlyList<PaymentRecord>)records.Select(r => InsertRow(c, t, loanId, r, now)).ToList();
        });
    }

    public bool Delete(long loanId, long paymentId) => Write("delete the payment", (c, t) =>
        c.Execute(
            "DELETE FROM payment_records WHERE id = @paymentId AND loan_id = @loanId",
            new { loanId, paymentId }, t) > 0);

    private static PaymentRecord InsertRow(SqliteConnection c, SqliteTransaction t, long loanId, PaymentRecord record, DateTime now)
    {
        var id = c.ExecuteScalar<long>(
            """
            INSERT INTO payment_records (loan_id, date, amount, principal, interest, note, created_at)
            VALUES (@loanId, @Date, @Amount, @Principal, @Interest, @Note, @now)
            RETURNING id
            """,
            new { loanId, record.Date, record.Amount, record.Principal, record.Interest, record.Note, now }, t);
        return new PaymentRecord
        {
            Id = id,
            LoanId = loanId,
            Date = record.Date,
            Amount = record.Amount,
            Principal = record.Principal,
            Interest = record.Interest,
            Note = record.Note,
            CreatedAt = now,
        };
    }
}
