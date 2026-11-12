namespace TaskFlow.Core.Models;

/// <summary>How important a task is. The numeric values are used for sorting (higher = more important).</summary>
public enum Priority
{
    Low = 0,
    Medium = 1,
    High = 2,
}
