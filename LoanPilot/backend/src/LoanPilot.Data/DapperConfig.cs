using System.Data;
using System.Globalization;
using Dapper;

namespace LoanPilot.Data;

/// <summary>
/// Dapper type handlers that make SQLite's TEXT storage round-trip exactly: money as invariant-culture
/// text, dates as <c>yyyy-MM-dd</c> and timestamps as ISO-8601 UTC. Enums are stored by name too, but
/// Dapper unwraps enum parameters to their integer value before it looks for a handler, so the
/// repositories write <c>enum.ToString()</c> explicitly; reading a name back into an enum is native Dapper.
/// </summary>
public static class DapperConfig
{
    private static int _registered;

    /// <summary>Registers the handlers once per process; further calls do nothing.</summary>
    public static void Register()
    {
        if (Interlocked.Exchange(ref _registered, 1) == 1)
        {
            return;
        }

        DefaultTypeMap.MatchNamesWithUnderscores = true;

        // Dapper maps these types itself and never consults a handler for them unless its built-in
        // mapping is removed first. Without this, SetValue below would not be called and values would
        // be written in the provider's own format (decimal as a binary-converted REAL, for one).
        SqlMapper.RemoveTypeMap(typeof(decimal));
        SqlMapper.RemoveTypeMap(typeof(decimal?));
        SqlMapper.RemoveTypeMap(typeof(DateTime));
        SqlMapper.RemoveTypeMap(typeof(DateTime?));

        // TypeHandler<T> also covers Nullable<T>.
        SqlMapper.AddTypeHandler(new DecimalHandler());
        SqlMapper.AddTypeHandler(new DateOnlyHandler());
        SqlMapper.AddTypeHandler(new UtcDateTimeHandler());
    }

    public static string FormatDecimal(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    public static string FormatDate(DateOnly value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public static string FormatTimestamp(DateTime value) =>
        DateTime.SpecifyKind(value.ToUniversalTime(), DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture);

    private sealed class DecimalHandler : SqlMapper.TypeHandler<decimal>
    {
        public override void SetValue(IDbDataParameter parameter, decimal value)
        {
            parameter.DbType = DbType.String;
            parameter.Value = FormatDecimal(value);
        }

        public override decimal Parse(object value) => value is string text
            ? decimal.Parse(text, NumberStyles.Float, CultureInfo.InvariantCulture)
            : Convert.ToDecimal(value, CultureInfo.InvariantCulture);
    }

    private sealed class DateOnlyHandler : SqlMapper.TypeHandler<DateOnly>
    {
        public override void SetValue(IDbDataParameter parameter, DateOnly value)
        {
            parameter.DbType = DbType.String;
            parameter.Value = FormatDate(value);
        }

        public override DateOnly Parse(object value) =>
            DateOnly.ParseExact((string)value, "yyyy-MM-dd", CultureInfo.InvariantCulture);
    }

    private sealed class UtcDateTimeHandler : SqlMapper.TypeHandler<DateTime>
    {
        public override void SetValue(IDbDataParameter parameter, DateTime value)
        {
            parameter.DbType = DbType.String;
            parameter.Value = FormatTimestamp(value);
        }

        public override DateTime Parse(object value) =>
            DateTime.Parse(
                (string)value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
    }
}
