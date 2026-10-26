namespace MetroSim.Core.Engine;

public interface IEntity
{
    int Id { get; set; }
}

/// <summary>
/// Slot array of entities keyed by id (id = slot index, 0 is never used). Iteration is always in id
/// order and freed ids are reused LIFO; the free list is saved so that a loaded game reuses ids exactly
/// like the uninterrupted one would.
/// </summary>
public sealed class EntityStore<T> where T : class, IEntity
{
    private T?[] _slots = new T?[64];
    private readonly List<int> _free = [];

    /// <summary>One past the highest id ever handed out. Loop <c>for (int id = 1; id &lt; HighWater; id++)</c>.</summary>
    public int HighWater { get; private set; } = 1;

    public int Count { get; private set; }

    public IReadOnlyList<int> FreeIds => _free;

    public T? this[int id] => (uint)id < (uint)HighWater ? _slots[id] : null;

    public T? Get(int id) => this[id];

    public int Add(T item)
    {
        int id;
        if (_free.Count > 0)
        {
            id = _free[^1];
            _free.RemoveAt(_free.Count - 1);
        }
        else
        {
            id = HighWater++;
            if (id >= _slots.Length)
            {
                Array.Resize(ref _slots, _slots.Length * 2);
            }
        }

        item.Id = id;
        _slots[id] = item;
        Count++;
        return id;
    }

    public bool Remove(int id)
    {
        if (this[id] is null)
        {
            return false;
        }

        _slots[id] = null;
        _free.Add(id);
        Count--;
        return true;
    }

    /// <summary>Live entities in id order. Allocation-free when enumerated with foreach.</summary>
    public Enumerator GetEnumerator() => new(this);

    /// <summary>Restores exact slot layout (used by the deserializer).</summary>
    internal void Restore(int highWater, IEnumerable<T> items, IEnumerable<int> freeIds)
    {
        _slots = new T?[Math.Max(64, highWater + 1)];
        HighWater = highWater;
        Count = 0;
        foreach (var item in items)
        {
            _slots[item.Id] = item;
            Count++;
        }

        _free.Clear();
        _free.AddRange(freeIds);
    }

    public struct Enumerator(EntityStore<T> store)
    {
        private int _id;

        public T Current { get; private set; } = null!;

        public bool MoveNext()
        {
            while (++_id < store.HighWater)
            {
                var item = store._slots[_id];
                if (item is not null)
                {
                    Current = item;
                    return true;
                }
            }

            return false;
        }
    }
}
