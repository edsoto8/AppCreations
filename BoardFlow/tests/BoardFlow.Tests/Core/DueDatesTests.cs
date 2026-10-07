using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;

namespace BoardFlow.Tests.Core;

public sealed class DueDatesTests
{
    private static readonly DateOnly Today = new(2026, 3, 10);

    [Fact]
    public void NoDueDate_IsNone()
    {
        Assert.Equal(DueState.None, DueDates.GetState(null, Today));
    }

    [Fact]
    public void Yesterday_IsOverdue()
    {
        Assert.Equal(DueState.Overdue, DueDates.GetState(Today.AddDays(-1), Today));
    }

    [Fact]
    public void LongAgo_IsOverdue()
    {
        Assert.Equal(DueState.Overdue, DueDates.GetState(new DateOnly(2020, 1, 1), Today));
    }

    [Fact]
    public void Today_IsDueToday()
    {
        Assert.Equal(DueState.DueToday, DueDates.GetState(Today, Today));
    }

    [Fact]
    public void Tomorrow_IsDueSoon()
    {
        Assert.Equal(DueState.DueSoon, DueDates.GetState(Today.AddDays(1), Today));
    }

    [Fact]
    public void TodayPlusSoonDays_IsStillDueSoon()
    {
        Assert.Equal(7, DueDates.SoonDays);
        Assert.Equal(DueState.DueSoon, DueDates.GetState(Today.AddDays(7), Today));
    }

    [Fact]
    public void TodayPlusEight_IsLater()
    {
        Assert.Equal(DueState.Later, DueDates.GetState(Today.AddDays(8), Today));
    }

    [Fact]
    public void FarFuture_IsLater()
    {
        Assert.Equal(DueState.Later, DueDates.GetState(new DateOnly(2030, 1, 1), Today));
    }

    [Fact]
    public void Boundaries_HoldAcrossAYearEnd()
    {
        var today = new DateOnly(2026, 12, 28);
        Assert.Equal(DueState.DueSoon, DueDates.GetState(new DateOnly(2027, 1, 4), today));
        Assert.Equal(DueState.Later, DueDates.GetState(new DateOnly(2027, 1, 5), today));
        Assert.Equal(DueState.Overdue, DueDates.GetState(new DateOnly(2026, 12, 27), today));
    }
}
