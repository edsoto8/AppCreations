using TaskFlow.Core.Logic;
using TaskFlow.Core.Models;
using static TaskFlow.Tests.TestData;

namespace TaskFlow.Tests;

public class TaskQueryTests
{
    private static readonly TaskItem OpenHighLate = Item("open-high-late", Priority.High, Today.AddDays(5), createdMinute: 1);
    private static readonly TaskItem OpenLowSoon = Item("open-low-soon", Priority.Low, Today.AddDays(1), createdMinute: 2);
    private static readonly TaskItem OpenMediumNoDate = Item("open-medium-nodate", Priority.Medium, createdMinute: 3);
    private static readonly TaskItem DoneHighSoon = Item("done-high-soon", Priority.High, Today, completed: true, createdMinute: 4);

    private static readonly TaskItem[] All = [OpenHighLate, OpenLowSoon, OpenMediumNoDate, DoneHighSoon];

    private static string[] Titles(IEnumerable<TaskItem> items) => items.Select(t => t.Title).ToArray();

    [Fact]
    public void Filter_Active_ExcludesCompleted()
    {
        var result = TaskQuery.Apply(All, TaskFilter.Active, TaskSortOrder.DueDate);
        Assert.DoesNotContain(DoneHighSoon, result);
        Assert.Equal(3, result.Count);
    }

    [Fact]
    public void Filter_Completed_OnlyCompleted()
    {
        var result = TaskQuery.Apply(All, TaskFilter.Completed, TaskSortOrder.DueDate);
        Assert.Equal([DoneHighSoon], result);
    }

    [Fact]
    public void Sort_DueDate_EarliestFirst_NoDateLast_CompletedAtEnd()
    {
        var result = TaskQuery.Apply(All, TaskFilter.All, TaskSortOrder.DueDate);
        Assert.Equal(["open-low-soon", "open-high-late", "open-medium-nodate", "done-high-soon"], Titles(result));
    }

    [Fact]
    public void Sort_Priority_HighestFirst_CompletedAtEnd()
    {
        var result = TaskQuery.Apply(All, TaskFilter.All, TaskSortOrder.Priority);
        Assert.Equal(["open-high-late", "open-medium-nodate", "open-low-soon", "done-high-soon"], Titles(result));
    }

    [Fact]
    public void Sort_Priority_TiesBrokenByDueDate()
    {
        var later = Item("later", Priority.High, Today.AddDays(3));
        var sooner = Item("sooner", Priority.High, Today.AddDays(1));
        var result = TaskQuery.Apply([later, sooner], TaskFilter.All, TaskSortOrder.Priority);
        Assert.Equal(["sooner", "later"], Titles(result));
    }

    [Fact]
    public void Apply_EmptyInput_ReturnsEmpty()
    {
        Assert.Empty(TaskQuery.Apply([], TaskFilter.All, TaskSortOrder.Priority));
    }
}
