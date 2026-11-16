namespace FileImporter.Core.Models;

/// <summary>What the validation stored procedure returned.</summary>
public sealed record ValidationResult(bool IsValid, string? Message)
{
    public static ValidationResult Success { get; } = new(true, null);

    public static ValidationResult Failure(string message) => new(false, message);
}
