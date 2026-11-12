using System.Collections.ObjectModel;
using System.Collections.Specialized;
using TaskFlow.Core.Logic;

namespace TaskFlow.Tests;

public class CollectionSyncTests
{
    [Theory]
    [InlineData(new int[0], new[] { 1, 2, 3 })]
    [InlineData(new[] { 1, 2, 3 }, new int[0])]
    [InlineData(new[] { 1, 2, 3 }, new[] { 3, 2, 1 })]
    [InlineData(new[] { 1, 2, 3, 4 }, new[] { 4, 1, 5 })]
    [InlineData(new[] { 1, 2, 3 }, new[] { 1, 2, 3 })]
    [InlineData(new[] { 5 }, new[] { 1, 5, 2 })]
    public void SyncTo_MakesTargetEqualDesired(int[] start, int[] desired)
    {
        var target = new ObservableCollection<int>(start);
        target.SyncTo(desired);
        Assert.Equal(desired, target);
    }

    [Fact]
    public void SyncTo_SameContents_RaisesNoChanges()
    {
        var target = new ObservableCollection<string>(["a", "b"]);
        var changes = 0;
        target.CollectionChanged += (_, _) => changes++;

        target.SyncTo(["a", "b"]);

        Assert.Equal(0, changes);
    }

    [Fact]
    public void SyncTo_Reorder_UsesMoveNotRemoveAndAdd()
    {
        var target = new ObservableCollection<string>(["a", "b", "c"]);
        var actions = new List<NotifyCollectionChangedAction>();
        target.CollectionChanged += (_, e) => actions.Add(e.Action);

        target.SyncTo(["c", "a", "b"]);

        Assert.All(actions, a => Assert.Equal(NotifyCollectionChangedAction.Move, a));
    }
}
