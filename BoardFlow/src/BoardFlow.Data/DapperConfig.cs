using System.Data;
using System.Globalization;
using Dapper;

namespace BoardFlow.Data;

/// <summary>
/// Dapper type handlers so dates round-trip through SQLite's TEXT storage independent of the machine's
/// time zone. Timestamps are stored as ISO-8601 UTC text (<c>2026-03-10T09:00:00.0000000Z</c>), due
/// dates as <c>yyyy-MM-dd</c>.
/// </summary>
public static class DapperConfig
{
    private static int _configured;

    public static void Configure()
    {
        if (Interlocked.Exchange(ref _configured, 1) == 1)
        {
            return;
        }

        // Dapper maps DateTime parameters itself unless the built-in mapping is removed first; without
        // this, SetValue below is never called and values are written in the provider's own format.
        SqlMapper.RemoveTypeMap(typeof(DateTime));
        SqlMapper.RemoveTypeMap(typeof(DateTime?));
        SqlMapper.AddTypeHandler(new UtcDateTimeHandler());
        SqlMapper.AddTypeHandler(new DateOnlyHandler());
    }

    public static string FormatTimestamp(DateTime value) =>
        DateTime.SpecifyKind(value.ToUniversalTime(), DateTimeKind.Utc).ToString("O", CultureInfo.InvariantCulture);

    public static string FormatDate(DateOnly value) => value.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private sealed class UtcDateTimeHandler : SqlMapper.TypeHandler<DateTime>
    {
        public override void SetValue(IDbDataParameter parameter, DateTime value)
        {
            parameter.DbType = DbType.String;
            parameter.Value = FormatTimestamp(value);
        }

        /// <summary>
        /// Reads ISO-8601 with a <c>Z</c> and also text without a zone marker (e.g. Microsoft.Data.Sqlite's
        /// default <c>yyyy-MM-dd HH:mm:ss.fff</c>), which BoardFlow only ever wrote from UTC values.
        /// </summary>
        public override DateTime Parse(object value) =>
            DateTime.Parse(
                (string)value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal);
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
}
