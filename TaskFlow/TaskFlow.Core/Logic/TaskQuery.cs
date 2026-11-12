using TaskFlow.Core.Models;

namespace TaskFlow.Core.Logic;

/// <summary>Which tasks the list shows.</summary>
public enum TaskFilter
{
    All,
    Active,
    Completed,
}

/// <summary>How the list is ordered.</summary>
public enum TaskSortOrder
{
    DueDate,
    Priority,
}

/// <summary>
/// Pure filtering and sorting rules. "Pure" means: same input, same output, no side effects. That makes these
/// rules trivial to unit-test and keeps them out of the view model.
/// </summary>
public static class TaskQuery
{
    public static IReadOnlyList<TaskItem> Apply(IEnumerable<TaskItem> tasks, TaskFilter filter, TaskSortOrder sort)
    {
        var filtered = filter switch
        {
            TaskFilter.Active => tasks.Where(t => !t.IsCompleted),
            TaskFilter.Completed => tasks.Where(t => t.IsCompleted),
            _ => tasks,
        };

        // Open tasks always come before completed ones (this only matters for the "All" filter).
        var ordered = filtered.OrderBy(t => t.IsCompleted);

        ordered = sort switch
        {
            // Earliest due date first; tasks without a due date go last; ties are broken by priority.
            TaskSortOrder.DueDate => ordered
                .ThenBy(t => t.DueDate is null)
                .ThenBy(t => t.DueDate)
                .ThenByDescending(t => t.Priority),

            // Highest priority first; ties are broken by due date (no date last).
            _ => ordered
                .ThenByDescending(t => t.Priority)
                .ThenBy(t => t.DueDate is null)
                .ThenBy(t => t.DueDate),
        };

        // Final tie-breakers keep the order stable and predictable.
        return ordered.ThenBy(t => t.CreatedAt).ThenBy(t => t.Id).ToList();
    }
}
