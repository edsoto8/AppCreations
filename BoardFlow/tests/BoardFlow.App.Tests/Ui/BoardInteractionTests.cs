using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using BoardFlow.App.ViewModels;
using BoardFlow.Core.Domain;
using BoardFlow.Tests.App.Support;

namespace BoardFlow.Tests.App.Ui;

/// <summary>Drives the real window with simulated mouse and keyboard input on the headless platform.</summary>
public sealed class BoardInteractionTests
{
    [AvaloniaFact]
    public void WelcomeScreen_Renders()
    {
        using var s = new TestSession();
        s.Main.Initialize();
        s.Show();
        s.Screenshot("01-welcome");

        Assert.True(s.Main.ShowNoWorkspace);
    }

    [AvaloniaFact]
    public async Task PopulatedBoard_Renders()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s, "Website relaunch");
        var ws = s.Main.SelectedWorkspace!.Id;
        var bug = s.Labels.Create(ws, "Bug", "#E5534B");
        var design = s.Labels.Create(ws, "Design", "#7A5CDB");
        var columns = s.Board.Columns;
        s.Cards.Create(columns[0].Id, new CardInput("Collect feedback from the beta group", "Survey + interviews", Priority.Low, null, [design.Id]));
        s.Cards.Create(columns[0].Id, new CardInput("Pick analytics provider"));
        s.Cards.Create(columns[1].Id, new CardInput("Fix broken signup link on mobile", "", Priority.Critical, new DateOnly(2026, 3, 8), [bug.Id]));
        s.Cards.Create(columns[1].Id, new CardInput("Write release notes", "Draft in the wiki", Priority.Medium, new DateOnly(2026, 3, 10)));
        s.Cards.Create(columns[2].Id, new CardInput("New pricing page", "Three tiers", Priority.High, new DateOnly(2026, 3, 14), [design.Id, bug.Id]));
        s.Cards.Create(columns[4].Id, new CardInput("Set up staging server"));
        s.Board.Reload();
        s.Show();
        s.Screenshot("02-board");

        Assert.Equal(6, s.Board.TotalCards);
        Assert.NotNull(s.Window.CardButton(s.Board.Columns[1].Cards[0].Id));
    }

    [AvaloniaFact]
    public async Task DraggingCardToAnotherColumn_MovesAndPersists()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var a = Seed.AddCard(s, 0, "Alpha");
        var b = Seed.AddCard(s, 1, "Bravo");
        var c = Seed.AddCard(s, 1, "Charlie");
        var window = s.Show();

        // Drop Alpha on the upper half of Charlie: it goes between Bravo and Charlie.
        var charlie = window.CardButton(c.Id);
        window.Drag(window.CardButton(a.Id).At(window), charlie.At(window, 0.5, 0.2));

        var todo = s.Board.Columns[1];
        Assert.Equal(["Bravo", "Alpha", "Charlie"], todo.Cards.Select(x => x.Title));
        Assert.Empty(s.Board.Columns[0].Cards);
        Assert.Null(s.Main.Panels.Current);

        s.Restart();
        s.Main.Initialize();
        Assert.Equal(["Bravo", "Alpha", "Charlie"], s.Board.Columns[1].Cards.Select(x => x.Title));
    }

    [AvaloniaFact]
    public async Task DraggingCardWithinColumn_Reorders()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var first = Seed.AddCard(s, 0, "One");
        Seed.AddCard(s, 0, "Two");
        var third = Seed.AddCard(s, 0, "Three");
        var window = s.Show();

        window.Drag(window.CardButton(third.Id).At(window), window.CardButton(first.Id).At(window, 0.5, 0.1));
        Assert.Equal(["Three", "One", "Two"], s.Board.Columns[0].Cards.Select(x => x.Title));

        // Dropping below the last card sends it to the bottom.
        var column = window.ColumnBody(s.Board.Columns[0].Id);
        window.Drag(window.CardButton(third.Id).At(window), column.At(window, 0.5, 0.97));
        Assert.Equal(["One", "Two", "Three"], s.Board.Columns[0].Cards.Select(x => x.Title));
    }

    [AvaloniaFact]
    public async Task DraggingColumnHeader_ReordersColumns()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var window = s.Show(width: 1900);
        var done = s.Board.Columns[4];
        var todo = s.Board.Columns[1];

        window.Drag(window.ColumnHeader(done.Id).At(window, 0.3), window.ColumnHeader(todo.Id).At(window, 0.1));

        Assert.Equal(["Backlog", "Done", "Todo", "In Progress", "Review"], s.Board.Columns.Select(c => c.Name));
    }

    [AvaloniaFact]
    public async Task ClickingCard_OpensEditor_AndEscapeClosesIt()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Open me");
        var window = s.Show();

        window.Click(window.CardButton(card.Id).At(window));
        var editor = Assert.IsType<CardEditorViewModel>(s.Main.Panels.Current);
        Assert.Equal("Open me", editor.Title);
        s.Screenshot("03-card-editor");

        window.KeyPress(Key.Escape, RawInputModifiers.None, PhysicalKey.Escape, null);
        TestSession.Pump();
        Assert.Null(s.Main.Panels.Current);
    }

    [AvaloniaFact]
    public async Task CtrlF_FocusesSearch_AndCtrlN_OpensQuickAdd()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var window = s.Show();

        window.KeyPress(Key.F, RawInputModifiers.Control, PhysicalKey.F, "f");
        TestSession.Pump();
        Assert.True(window.Named<TextBox>("SearchBox").IsFocused);

        window.KeyPress(Key.N, RawInputModifiers.Control, PhysicalKey.N, "n");
        TestSession.Pump();
        Assert.True(s.Board.Columns[0].IsQuickAddOpen);
        await TestSession.WaitFor(() => window.FocusManager?.GetFocusedElement() is TextBox { Name: "QuickAddBox" });

        window.KeyTextInput("Typed via quick add");
        window.KeyPress(Key.Enter, RawInputModifiers.None, PhysicalKey.Enter, null);
        TestSession.Pump();
        Assert.Equal(["Typed via quick add"], s.Board.Columns[0].Cards.Select(c => c.Title));
        Assert.True(s.Board.Columns[0].IsQuickAddOpen);
        s.Screenshot("04-quick-add");
    }

    [AvaloniaFact]
    public async Task KeyboardShortcuts_MoveFocusedCard()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Seed.AddCard(s, 0, "Top");
        var bottom = Seed.AddCard(s, 0, "Bottom");
        var window = s.Show();

        window.CardButton(bottom.Id).Focus(NavigationMethod.Tab);
        window.KeyPress(Key.Up, RawInputModifiers.Control, PhysicalKey.ArrowUp, null);
        TestSession.Pump();
        Assert.Equal(["Bottom", "Top"], s.Board.Columns[0].Cards.Select(c => c.Title));

        await TestSession.WaitFor(() => window.FocusManager?.GetFocusedElement() is Button { DataContext: CardItemViewModel { Id: var id } } && id == bottom.Id);
        window.KeyPress(Key.Right, RawInputModifiers.Control, PhysicalKey.ArrowRight, null);
        TestSession.Pump();
        Assert.Equal(["Bottom"], s.Board.Columns[1].Cards.Select(c => c.Title));
    }

    [AvaloniaFact]
    public async Task MinimumWindowSize_StillShowsBoardAndHeader()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Seed.AddCard(s, 0, "A card with a reasonably long title that needs to wrap onto more lines");
        var window = s.Show(960, 600);
        s.Screenshot("05-min-size");

        Assert.True(window.Named<TextBox>("SearchBox").IsEffectivelyVisible);
        Assert.True(window.Named<ScrollViewer>("BoardScroller").Extent.Width > window.Bounds.Width - 252);
    }
}
