using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using Avalonia.Threading;
using Avalonia.VisualTree;
using BoardFlow.App.ViewModels;

namespace BoardFlow.App.Views;

/// <summary>
/// The columns-and-cards surface. Drag and drop is implemented with plain pointer events (press, move
/// past a small threshold, release) so it behaves identically on every platform and in headless tests.
/// The view only works out *where* something was dropped; <see cref="BoardViewModel"/> performs the move.
/// </summary>
public sealed partial class BoardView : UserControl
{
    private const double DragThreshold = 6;
    private const double AutoScrollMargin = 48;
    private const double AutoScrollStep = 18;

    private PendingDrag? _pending;
    private ActiveDrag? _drag;

    public BoardView()
    {
        InitializeComponent();
        AddHandler(PointerPressedEvent, OnPointerPressed, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(PointerMovedEvent, OnPointerMoved, RoutingStrategies.Tunnel | RoutingStrategies.Bubble, handledEventsToo: true);
        AddHandler(PointerReleasedEvent, OnPointerReleased, RoutingStrategies.Tunnel, handledEventsToo: true);
        AddHandler(Button.ClickEvent, OnButtonClick, RoutingStrategies.Bubble);
        AddHandler(KeyDownEvent, OnKeyDownTunnel, RoutingStrategies.Tunnel);
    }

    private BoardViewModel? ViewModel => DataContext as BoardViewModel;

    /// <summary>True while a card or column is being dragged.</summary>
    public bool IsDragging => _drag is not null;

    // ---- Click and keyboard -------------------------------------------------------------------

    private void OnButtonClick(object? sender, RoutedEventArgs e)
    {
        if (e.Source is Button { DataContext: CardItemViewModel card } button && button.Classes.Contains("card") && ViewModel is { } vm)
        {
            e.Handled = true;
            vm.OpenCardCommand.Execute(card);
        }
    }

    /// <summary>
    /// Keyboard alternative to dragging, on a focused card: Ctrl+Up/Down reorders within the column,
    /// Ctrl+Left/Right moves to the neighbouring column. Escape cancels an active drag.
    /// </summary>
    private void OnKeyDownTunnel(object? sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape && _drag is not null)
        {
            CancelDrag();
            e.Handled = true;
            return;
        }

        if (e.KeyModifiers is not (KeyModifiers.Control or KeyModifiers.Meta)
            || e.Source is not Button { DataContext: CardItemViewModel card } || ViewModel is not { } vm)
        {
            return;
        }

        switch (e.Key)
        {
            case Key.Up: vm.MoveCardVertically(card, -1); break;
            case Key.Down: vm.MoveCardVertically(card, 1); break;
            case Key.Left: vm.MoveCardToAdjacentColumn(card, -1); break;
            case Key.Right: vm.MoveCardToAdjacentColumn(card, 1); break;
            default: return;
        }

        e.Handled = true;
        FocusCardLater(card.Id);
    }

    private void FocusCardLater(long cardId) =>
        Dispatcher.UIThread.Post(() => CardButton(cardId)?.Focus(NavigationMethod.Tab), DispatcherPriority.Loaded);

    private Button? CardButton(long cardId) =>
        this.GetVisualDescendants().OfType<Button>()
            .FirstOrDefault(b => b.DataContext is CardItemViewModel c && c.Id == cardId && b.Classes.Contains("card"));

    // ---- Pointer drag ---------------------------------------------------------------------------

    /// <summary>
    /// Capture is lost when another window or the OS takes the mouse mid-drag (PointerCaptureLost is a
    /// direct event, raised on this control because the drag captured to it). Cancel instead of leaving
    /// a drag that would drop on the next unrelated click.
    /// </summary>
    protected override void OnPointerCaptureLost(PointerCaptureLostEventArgs e)
    {
        base.OnPointerCaptureLost(e);
        CancelDrag();
    }

    private void OnPointerPressed(object? sender, PointerPressedEventArgs e)
    {
        if (_drag is not null)
        {
            // A press while "dragging" means the release was never seen; drop nothing.
            CancelDrag();
        }

        _pending = null;
        if (_drag is not null || !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed || e.Source is not Visual source)
        {
            return;
        }

        var point = e.GetPosition(this);
        if (source.FindAncestorOfType<Button>(includeSelf: true) is { DataContext: CardItemViewModel card } cardButton
            && cardButton.Classes.Contains("card"))
        {
            _pending = new PendingDrag(point, card, null, cardButton);
        }
        else if (source.FindAncestorOfType<Button>(includeSelf: true) is null
                 && FindNamedAncestor(source, "ColumnHeader") is { DataContext: ColumnViewModel column } header)
        {
            _pending = new PendingDrag(point, null, column, header);
        }
    }

    private void OnPointerMoved(object? sender, PointerEventArgs e)
    {
        var point = e.GetPosition(this);
        if (_drag is not null && !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
        {
            CancelDrag();
            return;
        }

        if (_drag is null)
        {
            if (_pending is not { } pending || !e.GetCurrentPoint(this).Properties.IsLeftButtonPressed)
            {
                return;
            }

            var delta = point - pending.Start;
            if (Math.Abs(delta.X) < DragThreshold && Math.Abs(delta.Y) < DragThreshold)
            {
                return;
            }

            StartDrag(pending, e.Pointer);
        }

        e.Handled = true;
        AutoScroll(point);
        UpdateDrag(point);
    }

    private void OnPointerReleased(object? sender, PointerReleasedEventArgs e)
    {
        _pending = null;
        if (_drag is not { } drag)
        {
            return;
        }

        e.Handled = true;
        var target = drag.Target;
        EndDrag(e.Pointer);
        if (target is null || ViewModel is not { } vm)
        {
            return;
        }

        if (drag.Card is { } card)
        {
            vm.MoveCard(card.Id, target.ColumnId, target.BeforeId);
            FocusCardLater(card.Id);
        }
        else if (drag.Column is { } column)
        {
            vm.MoveColumn(column.Id, target.BeforeId);
        }
    }

    private void StartDrag(PendingDrag pending, IPointer pointer)
    {
        _pending = null;
        _drag = new ActiveDrag(pending.Card, pending.Column, pending.Source);
        pending.Source.Classes.Add("dragging");
        if (pending.Card is null)
        {
            pending.Source.Opacity = 0.5;
        }

        DragGhostText.Text = pending.Card?.Title ?? pending.Column?.Name;
        DragGhost.IsVisible = true;
        Cursor = new Cursor(StandardCursorType.DragMove);
        pointer.Capture(this);
    }

    private void EndDrag(IPointer? pointer)
    {
        if (_drag is not { } drag)
        {
            return;
        }

        _drag = null;
        drag.Source.Classes.Remove("dragging");
        drag.Source.Opacity = 1;
        DragGhost.IsVisible = false;
        DropIndicator.IsVisible = false;
        Cursor = Cursor.Default;
        if (pointer?.Captured == this)
        {
            pointer.Capture(null);
        }
    }

    private void CancelDrag()
    {
        _pending = null;
        EndDrag(null);
    }

    private void UpdateDrag(Point point)
    {
        if (_drag is not { } drag)
        {
            return;
        }

        Canvas.SetLeft(DragGhost, point.X + 12);
        Canvas.SetTop(DragGhost, point.Y + 8);
        drag.Target = drag.Card is { } card ? FindCardTarget(point, card) : FindColumnTarget(point, drag.Column!);
        DropIndicator.IsVisible = drag.Target is not null;
        if (drag.Target is { } target)
        {
            Canvas.SetLeft(DropIndicator, target.Indicator.X);
            Canvas.SetTop(DropIndicator, target.Indicator.Y);
            DropIndicator.Width = target.Indicator.Width;
            DropIndicator.Height = target.Indicator.Height;
        }
    }

    /// <summary>The column under the pointer, and the visible card the dragged card should go above.</summary>
    private DropTarget? FindCardTarget(Point point, CardItemViewModel dragged)
    {
        var columns = ColumnBounds();
        if (columns.Count == 0)
        {
            return null;
        }

        // Nearest column horizontally, so drops in the gaps between columns still land somewhere sensible.
        var (column, columnRect, columnControl) = columns.MinBy(c =>
            point.X < c.Rect.Left ? c.Rect.Left - point.X : point.X > c.Rect.Right ? point.X - c.Rect.Right : 0);

        var cards = columnControl.GetVisualDescendants().OfType<Button>()
            .Where(b => b.Classes.Contains("card") && b.DataContext is CardItemViewModel c && c.Id != dragged.Id && b.IsEffectivelyVisible)
            .Select(b => (Card: (CardItemViewModel)b.DataContext!, Rect: BoundsIn(b)))
            .Where(c => c.Rect.HasValue)
            .Select(c => (c.Card, Rect: c.Rect!.Value))
            .OrderBy(c => c.Rect.Top)
            .ToList();

        var width = columnRect.Width - 16;
        var x = columnRect.Left + 8;
        foreach (var (card, rect) in cards)
        {
            if (point.Y < rect.Center.Y)
            {
                return new DropTarget(column.Id, card.Id, new Rect(x, rect.Top - 5.5, width, 3));
            }
        }

        var y = cards.Count > 0 ? cards[^1].Rect.Bottom + 2.5 : columnRect.Top + 44;
        return new DropTarget(column.Id, null, new Rect(x, y, width, 3));
    }

    /// <summary>The column the dragged column should be placed left of (null = last).</summary>
    private DropTarget? FindColumnTarget(Point point, ColumnViewModel dragged)
    {
        var columns = ColumnBounds();
        if (columns.Count == 0)
        {
            return null;
        }

        var top = columns.Min(c => c.Rect.Top);
        var height = Math.Max(60, columns.Max(c => c.Rect.Bottom) - top);
        foreach (var (column, rect, _) in columns)
        {
            if (point.X < rect.Center.X)
            {
                return column.Id == dragged.Id ? null : new DropTarget(0, column.Id, new Rect(rect.Left - 7.5, top, 3, height));
            }
        }

        return new DropTarget(0, null, new Rect(columns[^1].Rect.Right + 4.5, top, 3, height));
    }

    private List<(ColumnViewModel Column, Rect Rect, Control Control)> ColumnBounds()
    {
        var result = new List<(ColumnViewModel, Rect, Control)>();
        foreach (var container in ColumnsHost.GetRealizedContainers())
        {
            if (container.DataContext is ColumnViewModel { IsVisible: true } column && BoundsIn(container) is { } rect)
            {
                result.Add((column, rect, container));
            }
        }

        return result;
    }

    private Rect? BoundsIn(Visual visual) =>
        visual.TranslatePoint(default, this) is { } topLeft ? new Rect(topLeft, visual.Bounds.Size) : null;

    private void AutoScroll(Point point)
    {
        if (point.X < AutoScrollMargin)
        {
            BoardScroller.Offset = BoardScroller.Offset.WithX(Math.Max(0, BoardScroller.Offset.X - AutoScrollStep));
        }
        else if (point.X > Bounds.Width - AutoScrollMargin)
        {
            BoardScroller.Offset = BoardScroller.Offset.WithX(BoardScroller.Offset.X + AutoScrollStep);
        }
    }

    private static Control? FindNamedAncestor(Visual visual, string name)
    {
        for (Visual? current = visual; current is not null; current = current.GetVisualParent())
        {
            if (current is Control { Name: { } n } control && n == name)
            {
                return control;
            }
        }

        return null;
    }

    private sealed record PendingDrag(Point Start, CardItemViewModel? Card, ColumnViewModel? Column, Control Source);

    private sealed record DropTarget(long ColumnId, long? BeforeId, Rect Indicator);

    private sealed class ActiveDrag(CardItemViewModel? card, ColumnViewModel? column, Control source)
    {
        public CardItemViewModel? Card { get; } = card;

        public ColumnViewModel? Column { get; } = column;

        public Control Source { get; } = source;

        public DropTarget? Target { get; set; }
    }
}
