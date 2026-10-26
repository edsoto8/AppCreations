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
public sealed class EntityStore<T> : IEnumerable<T> where T : class, IEntity
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

    IEnumerator<T> IEnumerable<T>.GetEnumerator()
    {
        foreach (var item in this)
        {
            yield return item;
        }
    }

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => ((IEnumerable<T>)this).GetEnumerator();

    /// <summary>Restores exact slot layout (used by the deserializer).</summary>
    /// <exception cref="ArgumentException">Ids overlap, repeat, or do not cover 1..highWater-1 exactly.</exception>
    internal void Restore(int highWater, IEnumerable<T> items, IEnumerable<int> freeIds)
    {
        var slots = new T?[Math.Max(64, highWater + 1)];
        var seen = new bool[highWater];
        int count = 0;
        foreach (var item in items)
        {
            if (item.Id < 1 || item.Id >= highWater || seen[item.Id])
            {
                throw new ArgumentException($"duplicate or out-of-range id {item.Id}");
            }

            seen[item.Id] = true;
            slots[item.Id] = item;
            count++;
        }

        var free = new List<int>();
        foreach (int id in freeIds)
        {
            if (id < 1 || id >= highWater || seen[id])
            {
                throw new ArgumentException($"free id {id} is live, repeated or out of range");
            }

            seen[id] = true;
            free.Add(id);
        }

        if (count + free.Count != highWater - 1)
        {
            throw new ArgumentException("ids do not cover the table");
        }

        _slots = slots;
        HighWater = highWater;
        Count = count;
        _free.Clear();
        _free.AddRange(free);
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
