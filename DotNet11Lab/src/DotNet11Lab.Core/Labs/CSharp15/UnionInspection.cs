using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DotNet11Lab.Core.Labs.CSharp15;

/// <summary>One observed fact about how the compiler lowered a union, gathered by reflection at runtime.</summary>
public sealed record UnionFact(string Question, string Expression, string Answer);

public static class UnionInspection
{
    // <snippet:CSharp15.UnionFacts>
    public static IReadOnlyList<UnionFact> Inspect()
    {
        var type = typeof(PaymentResult);
        PaymentResult approved = new PaymentApproved("A123456", 42m, "4242");
        PaymentResult empty = default;

        var caseTypes = type.GetConstructors()
            .Select(c => c.GetParameters())
            .Where(p => p.Length == 1)
            .Select(p => p[0].ParameterType.Name);

        return
        [
            new("Is the union a value type?", "typeof(PaymentResult).IsValueType", type.IsValueType.ToString()),
            new("Does it implement IUnion?", "typeof(IUnion).IsAssignableFrom(typeof(PaymentResult))",
                typeof(IUnion).IsAssignableFrom(type).ToString()),
            new("Is it marked [Union]?", "type.IsDefined(typeof(UnionAttribute))", type.IsDefined(typeof(UnionAttribute)).ToString()),
            new("Generated constructors (one per case)", "type.GetConstructors()", string.Join(", ", caseTypes)),
            new("Where does the case live?", "approved.Value?.GetType().Name", approved.Value?.GetType().Name ?? "null"),
            new("Do type patterns test the contained value?", "approved is PaymentApproved", (approved is PaymentApproved).ToString()),
            new("Can a property pattern reach the value?", "approved is PaymentApproved { Amount: > 10 }",
                (approved is PaymentApproved { Amount: > 10 }).ToString()),
            new("What does default hold?", "default(PaymentResult).Value is null", (empty.Value is null).ToString()),
            new("Is default 'not null'?", "default(PaymentResult) is not null", (empty is not null).ToString()),
        ];
    }
    // </snippet:CSharp15.UnionFacts>

    /// <summary>Runs the switch that has no <c>null</c> arm against <c>default</c> and reports what happens.</summary>
    public static string DefaultWithoutNullArm()
    {
        try
        {
            return PaymentProcessor.DescribeWithoutNullArm(default);
        }
        catch (SwitchExpressionException ex)
        {
            return $"{ex.GetType().Name}: {ex.Message.ReplaceLineEndings(" ")}";
        }
    }
}

// <snippet:CSharp15.JsonUnion>
// Same case types, but deserialization picks the case by looking at which properties are present.
// Works because the three shapes are distinguishable: AuthorizationCode / DeclineCode / ReviewTicket.
[JsonUnion(TypeClassifier = typeof(JsonUnionTypeStructuralClassifier))]
public union ClassifiedPaymentResult(PaymentApproved, PaymentDeclined, PaymentPending);
// </snippet:CSharp15.JsonUnion>

/// <summary>Outcome of trying to read one JSON document into a union type.</summary>
public sealed record UnionReadAttempt(string UnionType, bool Succeeded, string Outcome);

public static class PaymentJson
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = false };

    // <snippet:CSharp15.JsonUnionRoundTrip>
    public static string Serialize(PaymentResult result) =>
        JsonSerializer.Serialize(result, Options);           // writes the active case only, no "$type"

    public static UnionReadAttempt ReadPlain(string json)
    {
        try
        {
            var value = JsonSerializer.Deserialize<PaymentResult>(json, Options);
            return new(nameof(PaymentResult), true, Format(value.Value));
        }
        catch (JsonException ex)   // three object cases: the token kind alone cannot pick one
        {
            return new(nameof(PaymentResult), false, ex.Message);
        }
    }

    public static UnionReadAttempt ReadClassified(string json)
    {
        try
        {
            var value = JsonSerializer.Deserialize<ClassifiedPaymentResult>(json, Options);
            return new(nameof(ClassifiedPaymentResult), true, Format(value.Value));
        }
        catch (JsonException ex)   // zero or several cases matched the property names
        {
            return new(nameof(ClassifiedPaymentResult), false, ex.Message);
        }
    }
    // </snippet:CSharp15.JsonUnionRoundTrip>

    private static string Format(object? value) => value is null ? "null (no case)" : $"{value.GetType().Name}: {value}";
}
