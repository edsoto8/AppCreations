namespace BoardFlow.Core.Domain;

/// <summary>Card priority. Stored as its integer value, so never renumber existing members.</summary>
public enum Priority
{
    None = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4,
}
