using System.Globalization;
using TaskFlow.Core.Models;
using TaskFlow.Core.ViewModels;

namespace TaskFlow.Tests;

public sealed class FormattingTests : IDisposable
{
    private static readonly DateOnly Today = new(2026, 3, 10);
    private readonly CultureInfo _originalCulture = CultureInfo.CurrentCulture;

    public FormattingTests()
    {
        // Month names depend on the culture; pin it so the expected strings are stable on any machine.
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
    }

    public void Dispose() => CultureInfo.CurrentCulture = _originalCulture;

    [Theory]
    [InlineData(0, "Due today")]
    [InlineData(1, "Due tomorrow")]
    [InlineData(-1, "Due yesterday")]
    [InlineData(5, "Due Mar 15")]
    [InlineData(-9, "Due Mar 1")]
    public void FormatDueDate_RelativeAndAbsolute(int offsetDays, string expected)
    {
        var text = TaskItemViewModel.FormatDueDate(Today.AddDays(offsetDays), Today);
        Assert.Equal(expected, text);
    }

    [Fact]
    public void FormatDueDate_OtherYear_IncludesYear()
    {
        Assert.Equal("Due Jan 2, 2027", TaskItemViewModel.FormatDueDate(new DateOnly(2027, 1, 2), Today));
    }

    [Fact]
    public void FormatDueDate_NoDate_IsEmpty()
    {
        Assert.Equal(string.Empty, TaskItemViewModel.FormatDueDate(null, Today));
    }

    [Fact]
    public void FormatOverdue_YesterdayAndOlder()
    {
        Assert.Equal("Overdue · yesterday", TaskItemViewModel.FormatOverdue(Today.AddDays(-1), Today));
        Assert.Equal("Overdue · Mar 3", TaskItemViewModel.FormatOverdue(Today.AddDays(-7), Today));
    }

    [Fact]
    public void Draft_Normalized_TrimsTitleAndDescription()
    {
        var draft = new TaskDraft("  a  ", "\n b \t", null, Priority.Low).Normalized();
        Assert.Equal("a", draft.Title);
        Assert.Equal("b", draft.Description);
    }

    [Fact]
    public void Choice_ToString_IsTheLabel()
    {
        Assert.Equal("Due date", new Choice<int>(1, "Due date").ToString());
    }
}
