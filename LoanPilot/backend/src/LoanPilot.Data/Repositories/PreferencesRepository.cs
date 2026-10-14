using System.Globalization;
using Dapper;
using LoanPilot.Core.Domain;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

namespace LoanPilot.Data.Repositories;

/// <summary>
/// Stores <see cref="UserPreferences"/> as key/value rows. Missing, unknown and unreadable entries never
/// fail a read: the default is used (unreadable values are logged as warnings).
/// </summary>
public sealed class PreferencesRepository(LoanPilotDatabase database, ILogger<PreferencesRepository> logger)
    : RepositoryBase(database, null, logger)
{
    public const string ThemeKey = "theme";
    public const string CurrencyKey = "currency";
    public const string DefaultAccrualMethodKey = "default_accrual_method";
    public const string SelectedLoanIdKey = "selected_loan_id";
    public const string ComparisonBudgetKey = "comparison_budget";

    private static readonly string[] Themes = ["system", "light", "dark"];

    public UserPreferences Get()
    {
        var stored = Read("load preferences", c =>
            c.Query<(string Key, string Value)>("SELECT key, value FROM preferences")
                .ToDictionary(row => row.Key, row => row.Value, StringComparer.Ordinal));

        var defaults = new UserPreferences();
        return new UserPreferences
        {
            Theme = ReadValue(stored, ThemeKey, defaults.Theme, TryParseTheme),
            Currency = ReadValue(stored, CurrencyKey, defaults.Currency, TryParseCurrency),
            DefaultAccrualMethod = ReadValue(stored, DefaultAccrualMethodKey, defaults.DefaultAccrualMethod, TryParseAccrualMethod),
            SelectedLoanId = ReadValue(stored, SelectedLoanIdKey, defaults.SelectedLoanId, TryParseLong),
            ComparisonBudget = ReadValue(stored, ComparisonBudgetKey, defaults.ComparisonBudget, TryParseDecimal),
        };
    }

    /// <summary>Writes every preference in one transaction. Null optional values remove their key.</summary>
    public void Save(UserPreferences preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);

        Write("save preferences", (c, t) =>
        {
            Put(c, t, ThemeKey, preferences.Theme);
            Put(c, t, CurrencyKey, preferences.Currency);
            Put(c, t, DefaultAccrualMethodKey, preferences.DefaultAccrualMethod.ToString());
            Put(c, t, SelectedLoanIdKey, preferences.SelectedLoanId?.ToString(CultureInfo.InvariantCulture));
            Put(c, t, ComparisonBudgetKey, preferences.ComparisonBudget is { } budget ? DapperConfig.FormatDecimal(budget) : null);
            return 0;
        });
    }

    private static void Put(SqliteConnection c, SqliteTransaction t, string key, string? value)
    {
        if (value is null)
        {
            c.Execute("DELETE FROM preferences WHERE key = @key", new { key }, t);
            return;
        }

        c.Execute(
            "INSERT INTO preferences (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            new { key, value }, t);
    }

    private delegate bool Parser<T>(string raw, out T value);

    /// <summary>Returns the parsed value, or <paramref name="fallback"/> when the key is absent or its value does not parse.</summary>
    private T ReadValue<T>(Dictionary<string, string> stored, string key, T fallback, Parser<T> tryParse)
    {
        if (!stored.TryGetValue(key, out var raw))
        {
            return fallback;
        }

        if (tryParse(raw, out var parsed))
        {
            return parsed;
        }

        Logger.LogWarning("Ignoring unreadable preference {Key} (value {Value}); using the default", key, raw);
        return fallback;
    }

    private static bool TryParseTheme(string raw, out string value)
    {
        value = raw;
        return Themes.Contains(raw);
    }

    private static bool TryParseCurrency(string raw, out string value)
    {
        value = raw;
        return !string.IsNullOrWhiteSpace(raw);
    }

    // Enum.TryParse would also accept numbers and case variants; only the names we write are valid.
    private static bool TryParseAccrualMethod(string raw, out AccrualMethod value)
    {
        value = default;
        return Enum.GetNames<AccrualMethod>().Contains(raw) && Enum.TryParse(raw, out value);
    }

    private static bool TryParseLong(string raw, out long? value)
    {
        var ok = long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed);
        value = ok ? parsed : null;
        return ok;
    }

    private static bool TryParseDecimal(string raw, out decimal? value)
    {
        var ok = decimal.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed);
        value = ok ? parsed : null;
        return ok;
    }
}
