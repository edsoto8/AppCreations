using BoardFlow.Core;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;

namespace BoardFlow.Tests.Core;

public sealed class ValidateTests
{
    [Fact]
    public void Name_TrimsSurroundingWhitespace()
    {
        Assert.Equal("Home", Validate.Name("  Home \t", "Board name"));
    }

    [Fact]
    public void Name_KeepsInnerWhitespace()
    {
        Assert.Equal("My  Board", Validate.Name("My  Board", "Board name"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t")]
    [InlineData("\r\n")]
    public void Name_RejectsBlank(string? value)
    {
        var ex = Assert.Throws<ValidationException>(() => Validate.Name(value, "Board name"));
        Assert.Contains("Board name", ex.Message);
        Assert.Contains("required", ex.Message);
    }

    [Theory]
    [InlineData("first\nsecond")]
    [InlineData("first\r\nsecond")]
    [InlineData("first\rsecond")]
    public void Name_RejectsMultiLine(string value)
    {
        var ex = Assert.Throws<ValidationException>(() => Validate.Name(value, "Board name"));
        Assert.Contains("single line", ex.Message);
    }

    [Fact]
    public void Name_IgnoresTrailingNewline()
    {
        Assert.Equal("abc", Validate.Name("abc\n", "Name"));
    }

    [Fact]
    public void Name_RejectsOverMaxLength()
    {
        var ex = Assert.Throws<ValidationException>(() => Validate.Name(new string('a', Validate.NameMaxLength + 1), "Name"));
        Assert.Contains(Validate.NameMaxLength.ToString(), ex.Message);
    }

    [Fact]
    public void Name_AcceptsExactlyMaxLength()
    {
        var value = new string('a', Validate.NameMaxLength);
        Assert.Equal(value, Validate.Name(value, "Name"));
    }

    [Fact]
    public void Name_MeasuresLengthAfterTrimming()
    {
        var core = new string('a', Validate.NameMaxLength);
        Assert.Equal(core, Validate.Name($"   {core}   ", "Name"));
    }

    [Fact]
    public void CardTitle_TrimsAndEnforcesItsOwnLimit()
    {
        Assert.Equal("Fix sink", Validate.CardTitle("  Fix sink  "));
        var max = new string('t', Validate.TitleMaxLength);
        Assert.Equal(max, Validate.CardTitle(max));
        Assert.Throws<ValidationException>(() => Validate.CardTitle(max + "t"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void CardTitle_RejectsBlank(string? value)
    {
        var ex = Assert.Throws<ValidationException>(() => Validate.CardTitle(value));
        Assert.Contains("Card title", ex.Message);
    }

    [Fact]
    public void CardTitle_RejectsMultiLine()
    {
        Assert.Throws<ValidationException>(() => Validate.CardTitle("one\ntwo"));
    }

    [Fact]
    public void LabelName_TrimsAndEnforcesItsOwnLimit()
    {
        Assert.Equal("Urgent", Validate.LabelName(" Urgent "));
        var max = new string('l', Validate.LabelNameMaxLength);
        Assert.Equal(max, Validate.LabelName(max));
        Assert.Throws<ValidationException>(() => Validate.LabelName(max + "l"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void LabelName_RejectsBlank(string? value)
    {
        var ex = Assert.Throws<ValidationException>(() => Validate.LabelName(value));
        Assert.Contains("Label name", ex.Message);
    }

    [Fact]
    public void LabelName_RejectsMultiLine()
    {
        Assert.Throws<ValidationException>(() => Validate.LabelName("a\nb"));
    }

    [Fact]
    public void Description_NullBecomesEmpty()
    {
        Assert.Equal("", Validate.Description(null));
    }

    [Fact]
    public void Description_WhitespaceOnlyBecomesEmpty()
    {
        Assert.Equal("", Validate.Description("  \n\t "));
    }

    [Fact]
    public void Description_TrimsTrailingButKeepsLeadingAndInnerWhitespace()
    {
        Assert.Equal("  line1\n\nline2", Validate.Description("  line1\n\nline2 \n\n"));
    }

    [Fact]
    public void Description_AcceptsExactlyMaxLength()
    {
        var value = new string('d', Validate.DescriptionMaxLength);
        Assert.Equal(value, Validate.Description(value));
    }

    [Fact]
    public void Description_RejectsOverMaxLength()
    {
        var value = new string('d', Validate.DescriptionMaxLength + 1);
        Assert.Throws<ValidationException>(() => Validate.Description(value));
    }

    [Theory]
    [InlineData("#abcdef", "#ABCDEF")]
    [InlineData("#ABCDEF", "#ABCDEF")]
    [InlineData("#a1B2c3", "#A1B2C3")]
    [InlineData("  #3a7bd5  ", "#3A7BD5")]
    public void Color_NormalisesToUpperCase(string input, string expected)
    {
        Assert.Equal(expected, Validate.Color(input));
    }

    [Theory]
    [InlineData("red")]
    [InlineData("#12345")]
    [InlineData("123456")]
    [InlineData("#1234567")]
    [InlineData("#GGGGGG")]
    [InlineData("#12 456")]
    [InlineData("")]
    [InlineData(null)]
    public void Color_RejectsInvalid(string? input)
    {
        Assert.Throws<ValidationException>(() => Validate.Color(input));
    }

    [Fact]
    public void Color_AcceptsEveryPaletteColor()
    {
        foreach (var color in LabelColors.Palette)
        {
            Assert.Equal(color.ToUpperInvariant(), Validate.Color(color));
        }
    }

    [Fact]
    public void Priority_AcceptsEveryDefinedValue()
    {
        foreach (var priority in Enum.GetValues<Priority>())
        {
            Assert.Equal(priority, Validate.Priority(priority));
        }
    }

    [Theory]
    [InlineData(5)]
    [InlineData(99)]
    [InlineData(-1)]
    public void Priority_RejectsUndefinedValue(int raw)
    {
        Assert.Throws<ValidationException>(() => Validate.Priority((Priority)raw));
    }
}
