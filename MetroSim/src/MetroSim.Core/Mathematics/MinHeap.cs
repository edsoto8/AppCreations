namespace MetroSim.Core.Mathematics;

/// <summary>
/// Binary min-heap of (priority, value) with insertion-order tie-breaking, so equal priorities pop in a
/// deterministic order. Reusable: <see cref="Clear"/> keeps the allocated storage.
/// </summary>
public sealed class MinHeap
{
    private (long Key, int Value)[] _items = new (long, int)[256];
    private long _sequence;

    public int Count { get; private set; }

    public void Clear()
    {
        Count = 0;
        _sequence = 0;
    }

    public void Push(int priority, int value)
    {
        if (Count == _items.Length)
        {
            Array.Resize(ref _items, _items.Length * 2);
        }

        // Priority in the high 32 bits, insertion sequence in the low 32: one comparison orders both.
        long key = ((long)priority << 32) | (uint)_sequence++;
        int i = Count++;
        while (i > 0)
        {
            int parent = (i - 1) >> 1;
            if (_items[parent].Key <= key)
            {
                break;
            }

            _items[i] = _items[parent];
            i = parent;
        }

        _items[i] = (key, value);
    }

    public int Pop(out int priority)
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

            if (child + 1 < Count && _items[child + 1].Key < _items[child].Key)
            {
                child++;
            }

            if (_items[child].Key >= last.Key)
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

        priority = (int)(top.Key >> 32);
        return top.Value;
    }
}
