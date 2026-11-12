using System.Collections.ObjectModel;

namespace TaskFlow.Core.Logic;

/// <summary>
/// Makes an <see cref="ObservableCollection{T}"/> match a desired list using the fewest Insert/Move/Remove calls.
/// Updating in place (instead of Clear + Add) lets the ListView keep its scroll position and item containers.
/// </summary>
public static class CollectionSync
{
    public static void SyncTo<T>(this ObservableCollection<T> target, IReadOnlyList<T> desired)
    {
        for (var i = 0; i < desired.Count; i++)
        {
            var item = desired[i];
            if (i < target.Count && EqualityComparer<T>.Default.Equals(target[i], item))
            {
                continue;
            }

            var existingIndex = target.IndexOf(item);
            if (existingIndex >= 0)
            {
                target.Move(existingIndex, i);
            }
            else
            {
                target.Insert(i, item);
            }
        }

        // Everything after the desired items is no longer wanted.
        while (target.Count > desired.Count)
        {
            target.RemoveAt(target.Count - 1);
        }
    }
}
