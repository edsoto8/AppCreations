using DotNet11Lab.Core.Labs.Ai;

namespace DotNet11Lab.Tests.Lab9Ai;

public class LabAiToolsTests
{
    [Fact]
    public void Zstandard_tool_round_trips_and_compresses_repetitive_text()
    {
        var r = LabAiTools.MeasureZstandard();
        Assert.True(r.UsedSampleText);
        Assert.True(r.RoundTripVerified);
        Assert.True(r.ZstandardBytes < r.OriginalBytes);
        Assert.True(r.ZstandardRatio > 2);
        Assert.True(r.GZipBytes > 0 && r.BrotliBytes > 0);
    }

    [Fact]
    public void Zstandard_tool_clamps_quality_and_caps_input()
    {
        var r = LabAiTools.MeasureZstandard(new string('a', LabAiTools.MaxInputChars * 2), quality: 999);
        Assert.Equal(22, r.Quality);
        Assert.Equal(LabAiTools.MaxInputChars, r.OriginalBytes);
    }

    [Fact]
    public void Reconcile_uses_full_join_semantics()
    {
        var r = LabAiTools.ReconcileTransactions("A=1;B=2;C=3", "B=2;C=4;D=5");
        Assert.False(r.UsedSampleData);
        Assert.Equal(["A", "B", "C", "D"], r.Lines.Select(l => l.Id));
        Assert.Equal(["only in bank", "matched", "amount differs", "only in ledger"], r.Lines.Select(l => l.Outcome));
        Assert.Null(r.Lines[0].Ledger);
        Assert.Null(r.Lines[3].Bank);
    }

    [Fact]
    public void Lab_lookup_validates_the_number()
    {
        Assert.Equal("AI Integration", LabAiTools.GetLabFeatures(9).Title);
        Assert.Throws<ArgumentOutOfRangeException>(() => LabAiTools.GetLabFeatures(42));
    }

    [Fact]
    public void Search_ranks_name_matches_first()
    {
        var hits = LabAiTools.SearchFeatures("zstandard compression");
        Assert.Equal("Zstandard compression", hits[0].Name);
        Assert.Empty(LabAiTools.SearchFeatures("a b"));
    }

    [Fact]
    public void Functions_expose_json_schemas_with_the_parameters()
    {
        var functions = LabAiTools.CreateFunctions();
        Assert.Equal(5, functions.Count);
        var lab = functions.Single(f => f.Name == LabAiTools.GetLabFeaturesName);
        Assert.Contains("labNumber", lab.JsonSchema.GetRawText(), StringComparison.Ordinal);
    }

    [Fact]
    public void Runtime_info_reports_dotnet_11()
    {
        Assert.StartsWith(".NET 11", LabAiTools.GetRuntimeInfo().Framework, StringComparison.Ordinal);
    }
}
