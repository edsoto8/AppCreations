using System.Globalization;
using System.Text;
using StepRecorder.Core.Settings;

namespace StepRecorder.Core.Storage;

/// <summary>
/// Builds session folder names such as <c>2026-10-05_175700_My-Recording</c>.
/// </summary>
public static class SessionNaming
{
    public const int MaxNameLength = 50;

    // Windows rules are applied on every OS, so a folder made on one machine is valid on Windows.
    private static readonly char[] InvalidChars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

    public static string FolderName(DateTimeOffset startedAt, string name) =>
        startedAt.ToString("yyyy-MM-dd_HHmmss", CultureInfo.InvariantCulture) + "_" + SanitizeName(name);

    /// <summary>
    /// Makes a user-typed name safe for a folder: invalid characters become <c>_</c>, runs of whitespace
    /// become a single <c>-</c>, and an empty result falls back to the default name.
    /// </summary>
    public static string SanitizeName(string? name)
    {
        var builder = new StringBuilder();
        bool pendingSeparator = false;

        foreach (char c in (name ?? "").Trim())
        {
            if (char.IsWhiteSpace(c))
            {
                pendingSeparator = true;
                continue;
            }

            if (pendingSeparator)
            {
                builder.Append('-');
                pendingSeparator = false;
            }

            builder.Append(char.IsControl(c) || Array.IndexOf(InvalidChars, c) >= 0 ? '_' : c);
        }

        string result = builder.ToString();
        if (result.Length > MaxNameLength)
        {
            result = result[..MaxNameLength];
        }

        // Windows silently strips trailing dots and spaces from folder names.
        result = result.TrimEnd('.', '-');
        return result.Length == 0 ? StorageSettings.DefaultName : result;
    }
}
