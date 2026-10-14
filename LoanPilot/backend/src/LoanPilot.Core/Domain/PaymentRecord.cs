namespace LoanPilot.Core.Domain;

/// <summary>
/// An actual payment the user made, entered by hand or imported from CSV. The principal and
/// interest split is optional because many statements show only the amount.
/// </summary>
public sealed class PaymentRecord
{
    public long Id { get; set; }
    public long LoanId { get; set; }
    public DateOnly Date { get; set; }
    public decimal Amount { get; set; }
    public decimal? Principal { get; set; }
    public decimal? Interest { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}
