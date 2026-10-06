using System.Data;
using System.Globalization;
using Dapper;

namespace BoardFlow.Data;

/// <summary>
/// Dapper type handlers so dates round-trip through SQLite's TEXT storage without losing the UTC kind.
/// Timestamps are stored as ISO-8601 round-trip strings, due dates as <c>yyyy-MM-dd</c>.
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

        public override DateTime Parse(object value) =>
            DateTime.Parse((string)value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime();
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
