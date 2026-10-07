using System.Text.RegularExpressions;

namespace BoardFlow.Core.Rules;

/// <summary>Input validation shared by every write path. Each method returns the normalised value.</summary>
public static partial class Validate
{
    public const int NameMaxLength = 100;
    public const int TitleMaxLength = 200;
    public const int DescriptionMaxLength = 20_000;
    public const int LabelNameMaxLength = 40;

    /// <summary>A required single-line name (workspace, board, column). Trims and rejects blank/too long.</summary>
    public static string Name(string? value, string what) => RequiredText(value, what, NameMaxLength);

    public static string CardTitle(string? value) => RequiredText(value, "Card title", TitleMaxLength);

    public static string LabelName(string? value) => RequiredText(value, "Label name", LabelNameMaxLength);

    /// <summary>An optional multi-line description. Null becomes empty; trailing whitespace is trimmed.</summary>
    public static string Description(string? value)
    {
        var text = (value ?? "").TrimEnd();
        if (text.Length > DescriptionMaxLength)
        {
            throw new ValidationException($"Description must be {DescriptionMaxLength:N0} characters or fewer.");
        }

        return text;
    }

    public static Domain.Priority Priority(Domain.Priority value) =>
        Enum.IsDefined(value) ? value : throw new ValidationException($"Unknown priority '{(int)value}'.");

    /// <summary>A <c>#RRGGBB</c> colour. Accepts lower case and returns upper case.</summary>
    public static string Color(string? value)
    {
        var text = (value ?? "").Trim();
        if (!HexColor().IsMatch(text))
        {
            throw new ValidationException("Colour must be a hex value like #3A7BD5.");
        }

        return text.ToUpperInvariant();
    }

    private static string RequiredText(string? value, string what, int maxLength)
    {
        var text = (value ?? "").Trim();
        if (text.Length == 0)
        {
            throw new ValidationException($"{what} is required.");
        }

        if (text.Contains('\n') || text.Contains('\r'))
        {
            throw new ValidationException($"{what} must be a single line.");
        }

        if (text.Length > maxLength)
        {
            throw new ValidationException($"{what} must be {maxLength} characters or fewer.");
        }

        return text;
    }

    [GeneratedRegex("^#[0-9A-Fa-f]{6}$")]
    private static partial Regex HexColor();
}
