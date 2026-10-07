using System.Collections.ObjectModel;

namespace BoardFlow.App.ViewModels;

public static class CollectionSync
{
    /// <summary>
    /// Makes <paramref name="target"/> equal to <paramref name="desired"/> (by reference) with the fewest
    /// moves/inserts/removes, so unchanged items keep their UI containers, focus and scroll position.
    /// </summary>
    public static void SyncTo<T>(this ObservableCollection<T> target, IReadOnlyList<T> desired)
        where T : class
    {
        for (var i = 0; i < desired.Count; i++)
        {
            var item = desired[i];
            if (i < target.Count && ReferenceEquals(target[i], item))
            {
                continue;
            }

            var existing = IndexOf(target, item, i + 1);
            if (existing >= 0)
            {
                target.Move(existing, i);
            }
            else
            {
                target.Insert(i, item);
            }
        }

        while (target.Count > desired.Count)
        {
            target.RemoveAt(target.Count - 1);
        }
    }

    private static int IndexOf<T>(ObservableCollection<T> list, T item, int start)
        where T : class
    {
        for (var i = start; i < list.Count; i++)
        {
            if (ReferenceEquals(list[i], item))
            {
                return i;
            }
        }

        return -1;
    }
}
