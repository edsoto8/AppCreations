using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.VisualTree;
using BoardFlow.App.ViewModels;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Core.Domain;
using BoardFlow.Tests.App.Support;

namespace BoardFlow.Tests.App.Ui;

/// <summary>Regression tests for defects found in the independent review.</summary>
public sealed class ReviewRegressionUiTests
{
    private static void Key(Window window, Key key, RawInputModifiers modifiers = RawInputModifiers.None)
    {
        window.KeyPress(key, modifiers, PhysicalKey.None, null);
        window.KeyRelease(key, modifiers, PhysicalKey.None, null);
        TestSession.Pump();
    }

    private static Visual? Focused(Window window) => window.FocusManager?.GetFocusedElement() as Visual;

    private static bool FocusIsIn(Window window, string layerName) =>
        Focused(window)?.GetSelfAndVisualAncestors().Any(v => v is Control { Name: var n } && n == layerName) == true;

    [AvaloniaFact]
    public async Task DestructiveDialog_StartsOnCancel_SoEnterKeepsTheData()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var window = s.Show();

        var task = s.Main.DeleteWorkspaceCommand.ExecuteAsync(null);
        await TestSession.WaitFor(() => s.Dialog is not null);
        await TestSession.WaitFor(() => Focused(window) is Button { Name: "DialogCancel" });

        Key(window, Avalonia.Input.Key.Enter);
        await task;

        Assert.Single(s.Main.Workspaces);
        Assert.Null(s.Dialog);
    }

    [AvaloniaFact]
    public async Task EnterOnFocusedCancel_CancelsEvenAfterTabbingAround()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var window = s.Show();

        var task = s.Main.DeleteBoardCommand.ExecuteAsync(null);
        await TestSession.WaitFor(() => Focused(window) is Button { Name: "DialogCancel" });

        // Tab stays inside the dialog: Cancel → Delete → Cancel.
        Key(window, Avalonia.Input.Key.Tab);
        Assert.True(Focused(window) is Button { Name: "DialogConfirm" });
        Key(window, Avalonia.Input.Key.Tab);
        Assert.True(Focused(window) is Button { Name: "DialogCancel" });
        Key(window, Avalonia.Input.Key.Enter);
        await task;

        Assert.Single(s.Main.Boards);
    }

    [AvaloniaFact]
    public async Task TabInsideCardPanel_NeverReachesTheBoardBehindIt()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Focus me");
        var window = s.Show();
        window.Click(window.CardButton(card.Id).At(window));
        await TestSession.WaitFor(() => FocusIsIn(window, "PanelCard"));

        for (var i = 0; i < 25; i++)
        {
            Key(window, Avalonia.Input.Key.Tab, i % 3 == 0 ? RawInputModifiers.Shift : RawInputModifiers.None);
            Assert.True(FocusIsIn(window, "PanelCard"), $"Focus left the panel after {i + 1} Tab presses");
        }
    }

    [AvaloniaFact]
    public async Task PromptDialog_EnterInTextBoxConfirms()
    {
        using var s = new TestSession();
        s.Main.Initialize();
        var window = s.Show();

        var task = s.Main.NewWorkspaceCommand.ExecuteAsync(null);
        await TestSession.WaitFor(() => Focused(window) is TextBox);
        window.KeyTextInput("Typed");
        Key(window, Avalonia.Input.Key.Enter);
        await task;

        Assert.Equal("Typed", Assert.Single(s.Main.Workspaces).Name);
    }

    [AvaloniaFact]
    public async Task F1_ShowsShortcuts_EnterCloses()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var window = s.Show();

        Key(window, Avalonia.Input.Key.F1);
        await TestSession.WaitFor(() => s.Dialog is ShortcutsDialogViewModel);
        s.Screenshot("06-shortcuts");
        Assert.False(window.Named<Button>("DialogCancel").IsVisible);
        await TestSession.WaitFor(() => Focused(window) is Button { Name: "DialogConfirm" });

        Key(window, Avalonia.Input.Key.Enter);
        await TestSession.WaitFor(() => s.Dialog is null);
    }

    [AvaloniaFact]
    public async Task DragWhoseReleaseWasMissed_IsCancelled_NotDroppedOnNextClick()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var alpha = Seed.AddCard(s, 0, "Alpha");
        var window = s.Show();
        var start = window.CardButton(alpha.Id).At(window);

        window.MouseDown(start, MouseButton.Left);
        window.MouseMove(start + new Point(40, 10), RawInputModifiers.LeftMouseButton);
        window.MouseMove(start + new Point(120, 10), RawInputModifiers.LeftMouseButton);
        TestSession.Pump();

        // The button-up went elsewhere (e.g. another app took the mouse): the next move has no button held.
        var inProgress = window.ColumnBody(s.Board.Columns[2].Id).At(window);
        window.MouseMove(inProgress, RawInputModifiers.None);
        window.Click(inProgress);

        Assert.Equal(["Alpha"], s.Board.Columns[0].Cards.Select(c => c.Title));
        Assert.False(window.GetVisualDescendants().OfType<Border>().Single(b => b.Name == "DragGhost").IsVisible);
    }

    [AvaloniaFact]
    public async Task KeyboardReorder_WithSearchActive_SkipsHiddenCards()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Seed.AddCard(s, 0, "apple one");
        Seed.AddCard(s, 0, "banana");
        var second = Seed.AddCard(s, 0, "apple two");
        s.Board.SearchText = "apple";

        s.Board.MoveCardVertically(s.Board.FindCard(second.Id)!, -1);
        Assert.Equal(["apple two", "apple one"], s.Board.Columns[0].Cards.Select(c => c.Title));

        s.Board.MoveCardVertically(s.Board.FindCard(second.Id)!, 1);
        Assert.Equal(["apple one", "apple two"], s.Board.Columns[0].Cards.Select(c => c.Title));

        s.Board.ClearFilters();
        Assert.Equal(["apple one", "apple two", "banana"], s.Board.Columns[0].Cards.Select(c => c.Title));
    }

    [AvaloniaFact]
    public async Task SwitchingBoard_WithUnsavedEdits_AsksAndCanStay()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s, "First");
        await s.RunWithDialog(() => s.Main.NewBoardCommand.ExecuteAsync(null), d =>
        {
            ((BoardDialogViewModel)d).Name = "Second";
            d.Confirm();
        });
        s.Main.SelectedBoard = s.Main.Boards[0];
        var card = Seed.AddCard(s, 0, "Draft");
        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.FindCard(card.Id)!);
        var editor = (CardEditorViewModel)s.Main.Panels.Current!;
        editor.Title = "Edited";

        s.Main.SelectedBoard = s.Main.Boards[1];
        await TestSession.WaitFor(() => s.Dialog is not null);
        s.Dialog!.Cancel();
        await TestSession.WaitFor(() => s.Main.SelectedBoard?.Name == "First");

        Assert.Equal("First", s.Board.Name);
        Assert.Same(editor, s.Main.Panels.Current);

        s.Main.SelectedBoard = s.Main.Boards[1];
        await TestSession.WaitFor(() => s.Dialog is not null);
        s.Dialog!.Confirm();
        await TestSession.WaitFor(() => s.Board.Name == "Second");
        Assert.Null(s.Main.Panels.Current);
        Assert.Equal("Draft", s.Cards.Get(card.Id)!.Title);
    }

    [AvaloniaFact]
    public async Task NewColumn_StaysVisibleWhileColumnFilterIsActive()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        s.Board.ColumnOptions[0].IsSelected = true;

        await s.RunWithDialog(() => s.Board.AddColumnCommand.ExecuteAsync(null), d =>
        {
            ((TextPromptDialogViewModel)d).Text = "Brand new";
            d.Confirm();
        });

        Assert.Equal(["Backlog", "Brand new"], s.Board.Columns.Where(c => c.IsVisible).Select(c => c.Name));
    }

    [AvaloniaFact]
    public async Task DateRollover_RefreshesDueStates()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = s.Cards.Create(s.Board.Columns[0].Id, new CardInput("Due today", DueDate: s.Clock.Today));
        s.Board.Reload();
        Assert.True(s.Board.FindCard(card.Id)!.IsDueToday);

        s.Clock.Advance(TimeSpan.FromDays(1));
        s.Main.CheckDateRollover();

        Assert.True(s.Board.FindCard(card.Id)!.IsOverdue);
    }
}
