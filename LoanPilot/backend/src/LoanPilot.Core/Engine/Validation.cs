using LoanPilot.Core.Domain;

namespace LoanPilot.Core.Engine;

/// <summary>A user-facing validation problem. <see cref="Field"/> is the camelCase input property name.</summary>
public sealed record ValidationError(string Field, string Message);

public sealed class LoanValidationException(IReadOnlyList<ValidationError> errors)
    : Exception(errors.Count == 0 ? "Invalid input." : errors[0].Message)
{
    public IReadOnlyList<ValidationError> Errors { get; } = errors;
}

public static class LoanValidator
{
    public const decimal MaxAmount = 10_000_000m;
    public const int MaxTermMonths = 240;
    public const decimal MaxAprPercent = 100m;
    public const decimal MinAmount = 100m;

    public static IReadOnlyList<ValidationError> Validate(Loan loan, DateOnly today)
    {
        var errors = new List<ValidationError>();
        void Add(string field, string message) => errors.Add(new ValidationError(field, message));

        if (string.IsNullOrWhiteSpace(loan.Name))
        {
            Add("name", "Give the loan a name, for example the vehicle (\"2023 Honda CR-V\").");
        }
        else if (loan.Name.Trim().Length > 100)
        {
            Add("name", "The name can be at most 100 characters.");
        }

        CheckLength(loan.VehicleMake, "vehicleMake", "Make", 60, errors);
        CheckLength(loan.VehicleModel, "vehicleModel", "Model", 60, errors);
        CheckLength(loan.Lender, "lender", "Lender name", 100, errors);
        CheckLength(loan.Notes, "notes", "Notes", 2000, errors);

        if (loan.VehicleYear is { } year && (year < 1900 || year > today.Year + 2))
        {
            Add("vehicleYear", $"Enter a model year between 1900 and {today.Year + 2}.");
        }

        if (loan.OriginalAmount < MinAmount)
        {
            Add("originalAmount", "The original loan amount must be at least 100.");
        }
        else if (loan.OriginalAmount > MaxAmount)
        {
            Add("originalAmount", "The original loan amount looks too large (maximum 10,000,000).");
        }

        if (loan.DownPayment is < 0m)
        {
            Add("downPayment", "The down payment cannot be negative.");
        }

        if (loan.AprPercent < 0m)
        {
            Add("aprPercent", "The APR cannot be negative. Use 0 for an interest-free loan.");
        }
        else if (loan.AprPercent > MaxAprPercent)
        {
            Add("aprPercent", "Enter the APR as a percentage between 0 and 100 (for example 6.49).");
        }

        if (loan.TermMonths < 1 || loan.TermMonths > MaxTermMonths)
        {
            Add("termMonths", $"The loan term must be between 1 and {MaxTermMonths} months.");
        }

        if (loan.FirstPaymentDate <= loan.StartDate)
        {
            Add("firstPaymentDate", "The first payment date must be after the loan start date.");
        }
        else if (loan.FirstPaymentDate > loan.StartDate.AddYears(1))
        {
            Add("firstPaymentDate", "The first payment date must be within a year of the loan start date.");
        }

        if (loan.ScheduledPayment is { } payment)
        {
            if (payment <= 0m)
            {
                Add("scheduledPayment", "The payment must be greater than zero, or leave it blank to use the standard payment.");
            }
            else if (payment > MaxAmount)
            {
                Add("scheduledPayment", "The payment looks too large.");
            }
        }

        if (!Enum.IsDefined(loan.PaymentFrequency))
        {
            Add("paymentFrequency", "Choose a payment frequency.");
        }

        if (!Enum.IsDefined(loan.AccrualMethod))
        {
            Add("accrualMethod", "Choose how interest accrues.");
        }

        if (!Enum.IsDefined(loan.DayCountBasis))
        {
            Add("dayCountBasis", "Choose a day-count basis.");
        }

        if (loan.CurrentBalance is { } balance)
        {
            if (balance < 0m)
            {
                Add("currentBalance", "The current balance cannot be negative. Use 0 if the loan is paid off.");
            }
            else if (balance > MaxAmount)
            {
                Add("currentBalance", "The current balance looks too large.");
            }

            if (loan.BalanceAsOf is null)
            {
                Add("balanceAsOf", "Enter the date the current balance applies to (it is on your statement or lender app).");
            }
        }
        else if (loan.BalanceAsOf is not null)
        {
            Add("currentBalance", "Enter the current principal balance for the as-of date, or clear the date.");
        }

        if (loan.BalanceAsOf is { } asOf)
        {
            if (asOf < loan.StartDate)
            {
                Add("balanceAsOf", "The balance date cannot be before the loan start date.");
            }
            else if (asOf > today)
            {
                Add("balanceAsOf", "The balance date cannot be in the future.");
            }
        }

        if (loan.PaymentsMade is { } made && loan.TermMonths is >= 1 and <= MaxTermMonths && Enum.IsDefined(loan.PaymentFrequency))
        {
            var contract = loan.PaymentFrequency.PaymentsForTerm(loan.TermMonths);
            if (made < 0 || made > contract * 2)
            {
                Add("paymentsMade", $"Payments made must be between 0 and {contract * 2}.");
            }
        }

        if (loan.InterestPaidToDate is < 0m)
        {
            Add("interestPaidToDate", "Interest paid to date cannot be negative.");
        }

        if (loan.VehicleValue is < 0m)
        {
            Add("vehicleValue", "The vehicle value cannot be negative.");
        }

        return errors;
    }

    public static void EnsureValid(Loan loan, DateOnly today)
    {
        var errors = Validate(loan, today);
        if (errors.Count > 0)
        {
            throw new LoanValidationException(errors);
        }
    }

    private static void CheckLength(string? value, string field, string label, int max, List<ValidationError> errors)
    {
        if (value is not null && value.Length > max)
        {
            errors.Add(new ValidationError(field, $"{label} can be at most {max} characters."));
        }
    }
}

public static class ScenarioValidator
{
    public const int MaxRecurringExtras = 20;
    public const int MaxLumpSums = 50;

    /// <param name="requireName">True when saving; unsaved simulations may be unnamed.</param>
    public static IReadOnlyList<ValidationError> Validate(Scenario scenario, LoanAnalysis analysis, bool requireName,
        DisplayFormat? format = null)
    {
        format ??= DisplayFormat.Default;
        var errors = new List<ValidationError>();
        void Add(string field, string message) => errors.Add(new ValidationError(field, message));

        if (requireName && string.IsNullOrWhiteSpace(scenario.Name))
        {
            Add("name", "Give the scenario a name so you can find it later.");
        }
        else if (scenario.Name is { Length: > 100 })
        {
            Add("name", "The name can be at most 100 characters.");
        }

        if (scenario.Description is { Length: > 500 })
        {
            Add("description", "The description can be at most 500 characters.");
        }

        if (scenario.BudgetPayment is { } budget && budget < analysis.Status.ScheduledPayment)
        {
            Add("budgetPayment",
                $"Your budget must be at least your scheduled payment of {format.Money(analysis.Status.ScheduledPayment)}; " +
                "paying less than the scheduled amount would be a missed payment.");
        }
        else if (scenario.BudgetPayment is > LoanValidator.MaxAmount)
        {
            Add("budgetPayment", "The budget looks too large.");
        }

        if (scenario.RecurringExtras.Count > MaxRecurringExtras)
        {
            Add("recurringExtras", $"Use at most {MaxRecurringExtras} recurring extra payments.");
        }

        for (var i = 0; i < scenario.RecurringExtras.Count; i++)
        {
            var extra = scenario.RecurringExtras[i];
            if (extra.Amount <= 0m)
            {
                Add($"recurringExtras[{i}].amount", "Extra payment amounts must be greater than zero.");
            }
            else if (extra.Amount > LoanValidator.MaxAmount)
            {
                Add($"recurringExtras[{i}].amount", "The extra payment looks too large.");
            }

            if (extra is { StartDate: { } start, EndDate: { } end } && end < start)
            {
                Add($"recurringExtras[{i}].endDate", "The end date must be on or after the start date.");
            }
        }

        if (scenario.LumpSums.Count > MaxLumpSums)
        {
            Add("lumpSums", $"Use at most {MaxLumpSums} lump-sum payments.");
        }

        var earliest = analysis.Status.ProjectionStartDate;
        for (var i = 0; i < scenario.LumpSums.Count; i++)
        {
            var lump = scenario.LumpSums[i];
            if (lump.Amount <= 0m)
            {
                Add($"lumpSums[{i}].amount", "Lump-sum amounts must be greater than zero.");
            }
            else if (lump.Amount > LoanValidator.MaxAmount)
            {
                Add($"lumpSums[{i}].amount", "The lump sum looks too large.");
            }

            if (lump.Date < earliest)
            {
                Add($"lumpSums[{i}].date",
                    $"Lump sums must be dated on or after {format.LongDate(earliest)}, when the projection starts.");
            }

            if (lump.Note is { Length: > 200 })
            {
                Add($"lumpSums[{i}].note", "The note can be at most 200 characters.");
            }
        }

        return errors;
    }
}
