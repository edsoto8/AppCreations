using BoardFlow.Core.Domain;
using Dapper;

namespace BoardFlow.Tests.Support;

/// <summary>A workspace with one board and its columns, created through the repositories.</summary>
public sealed record BoardFixture(Workspace Workspace, Board Board, IReadOnlyList<BoardColumn> Columns)
{
    public BoardColumn this[int index] => Columns[index];
}

/// <summary>Shortcuts for building and inspecting data in repository tests.</summary>
public static class TestData
{
    private static readonly string[] ColumnNames = ["Todo", "Doing", "Review", "Done", "Extra"];

    public static BoardFixture CreateBoard(this TestDatabase db, int columns = 3, string workspaceName = "Personal")
    {
        var workspace = db.Workspaces.Create(workspaceName);
        return db.AddBoard(workspace, "Board", columns);
    }

    public static BoardFixture AddBoard(this TestDatabase db, Workspace workspace, string name, int columns = 3)
    {
        var board = db.Boards.Create(workspace.Id, name);
        var created = new List<BoardColumn>();
        for (var i = 0; i < columns; i++)
        {
            created.Add(db.Columns.Create(board.Id, ColumnNames[i]));
        }

        return new BoardFixture(workspace, board, created);
    }

    public static Card AddCard(this TestDatabase db, long columnId, string title) =>
        db.Cards.Create(columnId, new CardInput(title));

    /// <summary>Creates cards with the given titles at the bottom of the column, in order.</summary>
    public static List<Card> AddCards(this TestDatabase db, long columnId, params string[] titles) =>
        titles.Select(title => db.AddCard(columnId, title)).ToList();

    /// <summary>Titles of the active cards of one column, in the order the repository returns them.</summary>
    public static List<string> ActiveTitles(this TestDatabase db, long boardId, long columnId) =>
        db.Cards.GetByBoard(boardId).Where(c => c.ColumnId == columnId).Select(c => c.Title).ToList();

    /// <summary>Asserts that every column's active cards have sort orders exactly 0..n-1, in returned order.</summary>
    public static void AssertDenseOrder(this TestDatabase db, long boardId)
    {
        foreach (var group in db.Cards.GetByBoard(boardId).GroupBy(c => c.ColumnId))
        {
            Assert.Equal(Enumerable.Range(0, group.Count()), group.Select(c => c.SortOrder));
        }
    }

    public static int CountRows(this TestDatabase db, string table)
    {
        using var connection = db.Database.Open();
        return connection.ExecuteScalar<int>($"SELECT COUNT(*) FROM {table}");
    }
}
