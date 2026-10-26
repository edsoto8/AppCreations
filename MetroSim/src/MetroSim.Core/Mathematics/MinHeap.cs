namespace MetroSim.Core.Mathematics;

/// <summary>
/// Binary min-heap of (key, value). Equal keys pop in insertion order, so the order is deterministic
/// and independent of heap internals. Reusable: <see cref="Clear"/> keeps the allocated storage.
/// </summary>
public sealed class MinHeap
{
    private Entry[] _items = new Entry[256];
    private int _sequence;

    public int Count { get; private set; }

    public void Clear()
    {
        Count = 0;
        _sequence = 0;
    }

    public void Push(long key, int value)
    {
        if (Count == _items.Length)
        {
            Array.Resize(ref _items, _items.Length * 2);
        }

        var entry = new Entry(key, _sequence++, value);
        int i = Count++;
        while (i > 0)
        {
            int parent = (i - 1) >> 1;
            if (!Less(entry, _items[parent]))
            {
                break;
            }

            _items[i] = _items[parent];
            i = parent;
        }

        _items[i] = entry;
    }

    public int Pop(out long key)
    {
        var top = _items[0];
        var last = _items[--Count];
        int i = 0;
        while (true)
        {
            int child = 2 * i + 1;
            if (child >= Count)
            {
                break;
            }

            if (child + 1 < Count && Less(_items[child + 1], _items[child]))
            {
                child++;
            }

            if (!Less(_items[child], last))
            {
                break;
            }

            _items[i] = _items[child];
            i = child;
        }

        if (Count > 0)
        {
            _items[i] = last;
        }

        key = top.Key;
        return top.Value;
    }

    private static bool Less(in Entry a, in Entry b) => a.Key < b.Key || (a.Key == b.Key && a.Sequence < b.Sequence);

    private readonly record struct Entry(long Key, int Sequence, int Value);
}
