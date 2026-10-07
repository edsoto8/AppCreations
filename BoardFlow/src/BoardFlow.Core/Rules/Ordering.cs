namespace BoardFlow.Core.Rules;

/// <summary>
/// Pure list-ordering rules. Items are identified by id; the resulting index of each id is its new
/// <c>SortOrder</c>. Keeping positions dense (0..n-1) means every move is a deterministic rewrite of
/// the affected list, so repeated or rapid moves can never create gaps, ties or duplicates.
/// </summary>
public static class Ordering
{
    /// <summary>
    /// Returns <paramref name="ids"/> with <paramref name="movingId"/> removed (if present) and re-inserted
    /// immediately before <paramref name="beforeId"/>, or at the end when <paramref name="beforeId"/> is null.
    /// Works both for reordering within a list and for inserting an item that comes from another list.
    /// </summary>
    /// <exception cref="ArgumentException">
    /// <paramref name="beforeId"/> is not in the list, or equals <paramref name="movingId"/>.
    /// </exception>
    public static List<long> MoveBefore(IEnumerable<long> ids, long movingId, long? beforeId)
    {
        var result = ids.Where(id => id != movingId).ToList();
        if (beforeId is null)
        {
            result.Add(movingId);
            return result;
        }

        if (beforeId == movingId)
        {
            throw new ArgumentException("An item cannot be placed before itself.", nameof(beforeId));
        }

        var index = result.IndexOf(beforeId.Value);
        if (index < 0)
        {
            throw new ArgumentException($"Item {beforeId} is not in the target list.", nameof(beforeId));
        }

        result.Insert(index, movingId);
        return result;
    }

    /// <summary>
    /// Moves <paramref name="movingId"/> by <paramref name="offset"/> places, clamped to the list bounds.
    /// </summary>
    public static List<long> MoveBy(IReadOnlyList<long> ids, long movingId, int offset)
    {
        var result = ids.ToList();
        var from = result.IndexOf(movingId);
        if (from < 0)
        {
            throw new ArgumentException($"Item {movingId} is not in the list.", nameof(movingId));
        }

        var to = Math.Clamp(from + offset, 0, result.Count - 1);
        result.RemoveAt(from);
        result.Insert(to, movingId);
        return result;
    }
}
