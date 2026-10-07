using BoardFlow.Core.Rules;

namespace BoardFlow.Tests.Core;

public sealed class OrderingTests
{
    private static readonly long[] Ids = [1, 2, 3, 4, 5];

    [Fact]
    public void MoveBefore_InsertsBeforeAnchor_MovingBackward()
    {
        Assert.Equal([1, 4, 2, 3, 5], Ordering.MoveBefore(Ids, 4, 2));
    }

    [Fact]
    public void MoveBefore_InsertsBeforeAnchor_MovingForward()
    {
        // 2 is removed first, so "before 5" means directly in front of 5 in the remaining list.
        Assert.Equal([1, 3, 4, 2, 5], Ordering.MoveBefore(Ids, 2, 5));
    }

    [Fact]
    public void MoveBefore_ToFront()
    {
        Assert.Equal([5, 1, 2, 3, 4], Ordering.MoveBefore(Ids, 5, 1));
    }

    [Fact]
    public void MoveBefore_NullAnchor_MovesToEnd()
    {
        Assert.Equal([2, 3, 4, 5, 1], Ordering.MoveBefore(Ids, 1, null));
    }

    [Fact]
    public void MoveBefore_NullAnchor_WhenAlreadyLast_IsUnchanged()
    {
        Assert.Equal(Ids, Ordering.MoveBefore(Ids, 5, null));
    }

    [Fact]
    public void MoveBefore_ItemFromAnotherList_IsInsertedAtAnchor()
    {
        Assert.Equal([1, 2, 99, 3, 4, 5], Ordering.MoveBefore(Ids, 99, 3));
    }

    [Fact]
    public void MoveBefore_ItemFromAnotherList_WithNullAnchor_IsAppended()
    {
        Assert.Equal([1, 2, 3, 4, 5, 99], Ordering.MoveBefore(Ids, 99, null));
    }

    [Fact]
    public void MoveBefore_IntoEmptyList()
    {
        Assert.Equal([7], Ordering.MoveBefore([], 7, null));
    }

    [Fact]
    public void MoveBefore_AnchorMissing_Throws()
    {
        var ex = Assert.Throws<ArgumentException>(() => Ordering.MoveBefore(Ids, 2, 42));
        Assert.Equal("beforeId", ex.ParamName);
    }

    [Fact]
    public void MoveBefore_AnchorEqualsMovingItem_Throws()
    {
        var ex = Assert.Throws<ArgumentException>(() => Ordering.MoveBefore(Ids, 3, 3));
        Assert.Equal("beforeId", ex.ParamName);
    }

    [Fact]
    public void MoveBefore_DoesNotMutateInput()
    {
        var input = new List<long>(Ids);
        _ = Ordering.MoveBefore(input, 5, 1);
        Assert.Equal(Ids, input);
    }

    [Theory]
    [InlineData(2, 1, new long[] { 1, 3, 2, 4, 5 })]
    [InlineData(2, 2, new long[] { 1, 3, 4, 2, 5 })]
    [InlineData(4, -1, new long[] { 1, 2, 4, 3, 5 })]
    [InlineData(4, -3, new long[] { 4, 1, 2, 3, 5 })]
    public void MoveBy_MovesTheGivenNumberOfPlaces(long id, int offset, long[] expected)
    {
        Assert.Equal(expected, Ordering.MoveBy(Ids, id, offset));
    }

    [Fact]
    public void MoveBy_ClampsAtTheStart()
    {
        Assert.Equal([3, 1, 2, 4, 5], Ordering.MoveBy(Ids, 3, -100));
        Assert.Equal(Ids, Ordering.MoveBy(Ids, 1, -1));
    }

    [Fact]
    public void MoveBy_ClampsAtTheEnd()
    {
        Assert.Equal([1, 2, 4, 5, 3], Ordering.MoveBy(Ids, 3, 100));
        Assert.Equal(Ids, Ordering.MoveBy(Ids, 5, 1));
    }

    [Fact]
    public void MoveBy_ZeroOffset_IsNoOp()
    {
        Assert.Equal(Ids, Ordering.MoveBy(Ids, 3, 0));
    }

    [Fact]
    public void MoveBy_SingleItem_IsNoOp()
    {
        Assert.Equal([9], Ordering.MoveBy([9], 9, 5));
    }

    [Fact]
    public void MoveBy_MissingId_Throws()
    {
        var ex = Assert.Throws<ArgumentException>(() => Ordering.MoveBy(Ids, 42, 1));
        Assert.Equal("movingId", ex.ParamName);
    }

    [Fact]
    public void MoveBy_DoesNotMutateInput()
    {
        var input = new List<long>(Ids);
        _ = Ordering.MoveBy(input, 1, 3);
        Assert.Equal(Ids, input);
    }

    [Fact]
    public void RandomMoves_AlwaysYieldAPermutationAndPlaceTheItemWhereAsked()
    {
        var random = new Random(20260310);
        var expectedIds = new SortedSet<long>(Enumerable.Range(1, 12).Select(i => (long)i));
        var list = expectedIds.ToList();
        var nextForeignId = 1000L;

        for (var step = 0; step < 5000; step++)
        {
            switch (random.Next(3))
            {
                case 0:
                {
                    var moving = list[random.Next(list.Count)];
                    var offset = random.Next(-15, 16);
                    var from = list.IndexOf(moving);
                    list = Ordering.MoveBy(list, moving, offset);
                    Assert.Equal(Math.Clamp(from + offset, 0, expectedIds.Count - 1), list.IndexOf(moving));
                    break;
                }

                case 1:
                {
                    var moving = list[random.Next(list.Count)];
                    var anchor = list[random.Next(list.Count)];
                    if (anchor == moving)
                    {
                        list = Ordering.MoveBefore(list, moving, null);
                        Assert.Equal(moving, list[^1]);
                    }
                    else
                    {
                        list = Ordering.MoveBefore(list, moving, anchor);
                        Assert.Equal(list.IndexOf(anchor) - 1, list.IndexOf(moving));
                    }

                    break;
                }

                default:
                {
                    // An item arriving from another list.
                    var foreign = nextForeignId++;
                    expectedIds.Add(foreign);
                    long? anchor = random.Next(4) == 0 ? null : list[random.Next(list.Count)];
                    list = Ordering.MoveBefore(list, foreign, anchor);
                    Assert.Equal(anchor is null ? list.Count - 1 : list.IndexOf(anchor.Value) - 1, list.IndexOf(foreign));
                    break;
                }
            }

            Assert.Equal(expectedIds.Count, list.Count);
            Assert.Equal(expectedIds, list.Order());
        }
    }
}
