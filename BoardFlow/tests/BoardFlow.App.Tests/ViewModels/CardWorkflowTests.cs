using Avalonia.Headless.XUnit;
using BoardFlow.App.ViewModels;
using BoardFlow.App.ViewModels.Dialogs;
using BoardFlow.Core.Domain;
using BoardFlow.Tests.App.Support;

namespace BoardFlow.Tests.App.ViewModels;

public sealed class CardWorkflowTests
{
    private static async Task<CardEditorViewModel> OpenNewCard(TestSession s, int column)
    {
        await s.Board.NewCardCommand.ExecuteAsync(s.Board.Columns[column]);
        return Assert.IsType<CardEditorViewModel>(s.Main.Panels.Current);
    }

    [AvaloniaFact]
    public async Task CreateCardWithEveryField_ShowsSameValuesAfterRestart()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var editor = await OpenNewCard(s, 1);
        editor.Title = "Ship v2";
        editor.Description = "Line one\nLine two";
        editor.Priority = Priority.Critical;
        editor.DueDate = new DateTime(2026, 4, 1);
        editor.NewLabelName = "Release";
        editor.AddLabelCommand.Execute(null);
        editor.SelectedColumn = editor.ColumnChoices[2];
        editor.Save();

        Assert.Null(s.Main.Panels.Current);
        var tile = Assert.Single(s.Board.Columns[2].Cards);

        s.Restart();
        s.Main.Initialize();
        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.Columns[2].Cards.Single());
        var reopened = Assert.IsType<CardEditorViewModel>(s.Main.Panels.Current);
        Assert.Equal("Ship v2", reopened.Title);
        Assert.Equal("Line one\nLine two", reopened.Description);
        Assert.Equal(Priority.Critical, reopened.Priority);
        Assert.Equal(new DateTime(2026, 4, 1), reopened.DueDate);
        Assert.Equal("In Progress", reopened.SelectedColumn!.Name);
        Assert.Equal(["Release"], reopened.LabelChoices.Where(l => l.IsSelected).Select(l => l.Label.Name));
        Assert.Equal(tile.Id, s.Board.Columns[2].Cards.Single().Id);
    }

    [AvaloniaFact]
    public async Task EditEveryField_ThenClearOptionalOnes()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var label = s.Labels.Create(s.Main.SelectedWorkspace!.Id, "Waiting", "#3A7BD5");
        var card = s.Cards.Create(s.Board.Columns[0].Id, new CardInput("Old", "Old text", Priority.Low, new DateOnly(2026, 1, 1), [label.Id]));
        s.Board.Reload();

        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.FindCard(card.Id)!);
        var editor = (CardEditorViewModel)s.Main.Panels.Current!;
        editor.Title = "New";
        editor.Description = "";
        editor.Priority = Priority.None;
        editor.ClearDueDateCommand.Execute(null);
        editor.LabelChoices.Single().IsSelected = false;
        editor.Save();

        var stored = s.Cards.Get(card.Id)!;
        Assert.Equal("New", stored.Title);
        Assert.Equal("", stored.Description);
        Assert.Equal(Priority.None, stored.Priority);
        Assert.Null(stored.DueDate);
        Assert.Empty(stored.LabelIds);
    }

    [AvaloniaFact]
    public async Task BlankTitle_IsRejectedInline_AndNothingIsWritten()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var editor = await OpenNewCard(s, 0);
        editor.Title = "   ";
        editor.Save();

        Assert.Equal("Card title is required.", editor.Error);
        Assert.Same(editor, s.Main.Panels.Current);
        Assert.Equal(0, s.Board.TotalCards);
    }

    [AvaloniaFact]
    public async Task ClosingEditorWithUnsavedChanges_AsksBeforeDiscarding()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Original");
        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.FindCard(card.Id)!);
        var editor = (CardEditorViewModel)s.Main.Panels.Current!;
        editor.Title = "Changed";

        await s.RunWithDialog(() => s.Main.CloseTopmostAsync(), d => d.Cancel());
        Assert.Same(editor, s.Main.Panels.Current);

        await s.RunWithDialog(() => s.Main.CloseTopmostAsync(), d => d.Confirm());
        Assert.Null(s.Main.Panels.Current);
        Assert.Equal("Original", s.Cards.Get(card.Id)!.Title);
    }

    [AvaloniaFact]
    public async Task ArchiveFromEditor_HidesCard_ArchiveBrowserRestoresIt()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var keep = Seed.AddCard(s, 0, "Keep");
        var card = Seed.AddCard(s, 0, "Archive me");

        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.FindCard(card.Id)!);
        await ((CardEditorViewModel)s.Main.Panels.Current!).ToggleArchiveCommand.ExecuteAsync(null);

        Assert.Equal(["Keep"], s.Board.Columns[0].Cards.Select(c => c.Title));
        Assert.Equal(1, s.Board.ArchivedCount);

        await s.Board.OpenArchiveCommand.ExecuteAsync(null);
        var archive = Assert.IsType<ArchiveViewModel>(s.Main.Panels.Current);
        var item = Assert.Single(archive.Items);
        Assert.Equal("Backlog", item.ColumnName);

        archive.RestoreCommand.Execute(item);
        Assert.True(archive.IsEmpty);
        Assert.Equal(["Keep", "Archive me"], s.Board.Columns[0].Cards.Select(c => c.Title));
        Assert.Equal(0, s.Board.ArchivedCount);
        Assert.NotEqual(keep.Id, card.Id);
    }

    [AvaloniaFact]
    public async Task DeleteFromArchive_AsksThenDeletesPermanently()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Gone soon");
        s.Cards.SetArchived(card.Id, true);
        s.Board.Reload();

        await s.Board.OpenArchiveCommand.ExecuteAsync(null);
        var archive = (ArchiveViewModel)s.Main.Panels.Current!;
        await s.RunWithDialog(() => archive.DeleteCommand.ExecuteAsync(archive.Items[0]), d => d.Confirm());

        Assert.Null(s.Cards.Get(card.Id));
        Assert.True(archive.IsEmpty);
    }

    [AvaloniaFact]
    public async Task Duplicate_CreatesDistinctPersistedCardBelowOriginal_AndOpensIt()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var original = Seed.AddCard(s, 0, "Template", Priority.High);
        Seed.AddCard(s, 0, "Next");

        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.FindCard(original.Id)!);
        await ((CardEditorViewModel)s.Main.Panels.Current!).DuplicateCommand.ExecuteAsync(null);

        Assert.Equal(["Template", "Template (copy)", "Next"], s.Board.Columns[0].Cards.Select(c => c.Title));
        var copyEditor = Assert.IsType<CardEditorViewModel>(s.Main.Panels.Current);
        Assert.Equal("Template (copy)", copyEditor.Title);
        Assert.Equal(Priority.High, copyEditor.Priority);

        s.Restart();
        s.Main.Initialize();
        Assert.Equal(3, s.Board.Columns[0].Cards.Select(c => c.Id).Distinct().Count());
    }

    [AvaloniaFact]
    public async Task DeleteCard_RequiresConfirmation()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        var card = Seed.AddCard(s, 0, "Delete me");
        await s.Board.OpenCardCommand.ExecuteAsync(s.Board.FindCard(card.Id)!);
        var editor = (CardEditorViewModel)s.Main.Panels.Current!;

        await s.RunWithDialog(() => editor.DeleteCommand.ExecuteAsync(null), d => d.Cancel());
        Assert.NotNull(s.Cards.Get(card.Id));

        await s.RunWithDialog(() => editor.DeleteCommand.ExecuteAsync(null), d =>
        {
            Assert.True(d.IsDestructive);
            d.Confirm();
        });
        Assert.Null(s.Cards.Get(card.Id));
        Assert.Empty(s.Board.Columns[0].Cards);
    }

    [AvaloniaFact]
    public async Task QuickAdd_AddsToBottom_RejectsBlank()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        Assert.True(s.Board.BeginQuickAdd());
        var column = s.Board.Columns[0];

        column.QuickAddText = "First";
        column.SubmitQuickAddCommand.Execute(null);
        column.QuickAddText = "Second";
        column.SubmitQuickAddCommand.Execute(null);
        column.QuickAddText = "  ";
        column.SubmitQuickAddCommand.Execute(null);

        Assert.Equal(["First", "Second"], column.Cards.Select(c => c.Title));
        Assert.True(s.Main.Notifier.IsError);
        Assert.Equal("  ", column.QuickAddText);
    }

    [AvaloniaFact]
    public async Task RapidMoves_NeverDuplicateOrLoseCards()
    {
        using var s = new TestSession();
        await Seed.WorkspaceWithBoard(s);
        for (var i = 0; i < 12; i++)
        {
            Seed.AddCard(s, i % 3, $"Card {i}");
        }

        var random = new Random(7);
        for (var i = 0; i < 200; i++)
        {
            var columns = s.Board.Columns.Where(c => c.Cards.Count > 0).ToList();
            var source = columns[random.Next(columns.Count)];
            var card = source.Cards[random.Next(source.Cards.Count)];
            var target = s.Board.Columns[random.Next(5)];
            var before = target.Cards.Count == 0 || random.Next(3) == 0 ? null : (long?)target.Cards[random.Next(target.Cards.Count)].Id;
            s.Board.MoveCard(card.Id, target.Id, before == card.Id ? null : before);
        }

        var shown = s.Board.Columns.SelectMany(c => c.Cards).Select(c => c.Id).ToList();
        Assert.Equal(12, shown.Count);
        Assert.Equal(12, shown.Distinct().Count());
        s.Restart();
        s.Main.Initialize();
        Assert.Equal(shown.Order(), s.Board.Columns.SelectMany(c => c.Cards).Select(c => c.Id).Order());
    }
}
