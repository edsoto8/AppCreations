using TaskFlow.Core.Logic;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public class TaskValidatorTests
{
    [Fact]
    public void ValidDraft_HasNoErrors()
    {
        Assert.True(TaskValidator.Validate(Draft("Buy milk")).IsValid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void BlankTitle_IsInvalid(string title)
    {
        var result = TaskValidator.Validate(Draft(title));
        Assert.False(result.IsValid);
        Assert.NotNull(result.TitleError);
    }

    [Fact]
    public void Title_AtMaxLength_IsValid_OneOver_IsInvalid()
    {
        Assert.True(TaskValidator.Validate(Draft(new string('a', TaskValidator.MaxTitleLength))).IsValid);
        Assert.NotNull(TaskValidator.Validate(Draft(new string('a', TaskValidator.MaxTitleLength + 1))).TitleError);
    }

    [Fact]
    public void Title_LengthIsMeasuredAfterTrimming()
    {
        var padded = "  " + new string('a', TaskValidator.MaxTitleLength) + "  ";
        Assert.True(TaskValidator.Validate(Draft(padded)).IsValid);
    }

    [Fact]
    public void Description_OverMax_IsInvalid()
    {
        var result = TaskValidator.Validate(Draft("ok", description: new string('d', TaskValidator.MaxDescriptionLength + 1)));
        Assert.Null(result.TitleError);
        Assert.NotNull(result.DescriptionError);
    }

    [Fact]
    public void EnsureValid_Throws_ForInvalidDraft()
    {
        Assert.Throws<ArgumentException>(() => TaskValidator.EnsureValid(Draft("")));
    }
}
