using System.Runtime.CompilerServices;
using DotNet11Lab.Core.Labs.CSharp15;

namespace DotNet11Lab.Tests.Lab1CSharp15;

public class UnionTests
{
    [Theory]
    [InlineData("4111111111111111", 89.90, typeof(PaymentApproved))]
    [InlineData("4000000000000002", 50.00, typeof(PaymentDeclined))]
    [InlineData("4000000000000069", 50.00, typeof(PaymentDeclined))]
    [InlineData("5555555555554444", 18_450.00, typeof(PaymentPending))]
    [InlineData("4111111111111111", 0, typeof(PaymentDeclined))]
    public void Processor_returns_the_expected_case(string card, double amount, Type expected)
    {
        var result = PaymentProcessor.Process(new("ORD-1", (decimal)amount, card));

        Assert.IsType(expected, result.Value);
    }

    [Fact]
    public void Describe_matches_each_case_and_default()
    {
        Assert.StartsWith("Approved", PaymentProcessor.Describe(new PaymentApproved("A1", 10m, "1111")));
        Assert.StartsWith("Declined", PaymentProcessor.Describe(new PaymentDeclined("D-51", "Insufficient funds")));
        Assert.StartsWith("Pending", PaymentProcessor.Describe(new PaymentPending("RV-1", "fraud-review", TimeSpan.FromMinutes(5))));
        Assert.Equal("No payment attempted", PaymentProcessor.Describe(default));
    }

    [Fact]
    public void Processor_is_deterministic_across_calls()
    {
        var request = new PaymentRequest("ORD-77", 18_000m, "5555555555554444");
        Assert.Equal(PaymentProcessor.Process(request).Value, PaymentProcessor.Process(request).Value);
    }

    [Fact]
    public void Legacy_and_union_processors_agree()
    {
        foreach (var (_, request) in PaymentScenarios.All)
        {
            var union = PaymentProcessor.Process(request).Value!.GetType().Name;
            var legacy = LegacyPaymentProcessor.Process(request).GetType().Name;
            Assert.Equal(union.Replace("Payment", ""), legacy.Replace("Legacy", ""));
        }
    }

    [Fact]
    public void Union_is_a_struct_implementing_IUnion_with_null_default()
    {
        Assert.True(typeof(PaymentResult).IsValueType);
        Assert.True(typeof(IUnion).IsAssignableFrom(typeof(PaymentResult)));
        Assert.Null(default(PaymentResult).Value);

        var facts = UnionInspection.Inspect().ToDictionary(f => f.Expression, f => f.Answer);
        Assert.Equal("True", facts["approved is PaymentApproved"]);
        Assert.Equal("PaymentApproved, PaymentDeclined, PaymentPending", facts["type.GetConstructors()"]);
        Assert.Equal("False", facts["default(PaymentResult) is not null"]);
    }

    [Fact]
    public void Switch_without_null_arm_throws_on_default()
    {
        Assert.Throws<SwitchExpressionException>(() => PaymentProcessor.DescribeWithoutNullArm(default));
        Assert.StartsWith(nameof(SwitchExpressionException), UnionInspection.DefaultWithoutNullArm());
    }

    [Fact]
    public void Json_writes_only_the_active_case()
    {
        var json = PaymentJson.Serialize(new PaymentDeclined("D-51", "Insufficient funds"));

        Assert.Equal("""{"DeclineCode":"D-51","Reason":"Insufficient funds"}""", json);
        Assert.Equal("null", PaymentJson.Serialize(default));
    }

    [Fact]
    public void Plain_union_cannot_read_object_cases_but_structural_classifier_can()
    {
        const string json = """{"ReviewTicket":"RV-1","Queue":"fraud-review","ExpectedWait":"00:30:00"}""";

        var plain = PaymentJson.ReadPlain(json);
        var classified = PaymentJson.ReadClassified(json);

        Assert.False(plain.Succeeded);
        Assert.Contains("ambiguous", plain.Outcome, StringComparison.OrdinalIgnoreCase);
        Assert.True(classified.Succeeded);
        Assert.StartsWith(nameof(PaymentPending), classified.Outcome);
    }

    [Fact]
    public void Structural_classifier_rejects_a_shape_that_matches_no_case()
    {
        var attempt = PaymentJson.ReadClassified("""{"Unknown":1}""");
        Assert.False(attempt.Succeeded);
    }

    [Fact]
    public void Serialized_cases_round_trip_through_the_classified_union()
    {
        foreach (var (_, request) in PaymentScenarios.All)
        {
            var original = PaymentProcessor.Process(request);
            var attempt = PaymentJson.ReadClassified(PaymentJson.Serialize(original));
            Assert.True(attempt.Succeeded, attempt.Outcome);
            Assert.Contains(original.Value!.ToString()!, attempt.Outcome, StringComparison.Ordinal);
        }
    }
}
