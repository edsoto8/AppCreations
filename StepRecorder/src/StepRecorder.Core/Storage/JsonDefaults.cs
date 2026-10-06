using System.Text.Json;
using System.Text.Json.Serialization;

namespace StepRecorder.Core.Storage;

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };
}
