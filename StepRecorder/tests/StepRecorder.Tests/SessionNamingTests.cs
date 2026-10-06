using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed class SessionNamingTests
{
    [Fact]
    public void FolderName_StartsWithSortableTimestamp()
    {
        Assert.Equal("2026-10-05_175700_MyRecording", SessionNaming.FolderName(TestEnvironment.Start, "MyRecording"));
    }

    [Theory]
    [InlineData("My Recording", "My-Recording")]
    [InlineData("  lots   of\tspace  ", "lots-of-space")]
    [InlineData("a<b>c:d\"e/f\\g|h?i*j", "a_b_c_d_e_f_g_h_i_j")]
    [InlineData("tab\u0001char", "tab_char")]
    [InlineData("trailing dots...", "trailing-dots")]
    [InlineData("Ünïcødé 名前", "Ünïcødé-名前")]
    public void SanitizeName_ProducesSafeFolderNames(string input, string expected)
    {
        Assert.Equal(expected, SessionNaming.SanitizeName(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("...")]
    public void SanitizeName_EmptyResult_FallsBackToDefault(string? input)
    {
        Assert.Equal(StorageSettings.DefaultName, SessionNaming.SanitizeName(input));
    }

    [Fact]
    public void SanitizeName_TruncatesLongNames()
    {
        string result = SessionNaming.SanitizeName(new string('x', 200));

        Assert.Equal(SessionNaming.MaxNameLength, result.Length);
    }
}
