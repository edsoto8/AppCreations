using System.Diagnostics;
using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using MetroSim.App.Game;
using MetroSim.App.Rendering;
using MetroSim.App.Tools;
using MetroSim.Core.World;
using SkiaSharp;

namespace MetroSim.App.Controls;

/// <summary>
/// The interactive map. Every animation frame it builds an immutable <see cref="FrameSnapshot"/> under
/// the state lock (UI thread) and hands it to a <see cref="MapDrawOperation"/>, which the compositor
/// renders with Skia on its own thread. Input: left button uses the active tool, right/middle drag pans,
/// the wheel zooms around the cursor; WASD/arrows pan and +/- zoom via <see cref="HandleKeyDown"/>.
/// Frames are produced continuously while something moves (simulation running, camera keys held) and
/// on demand otherwise (input, view model changes), so a paused, idle city costs no CPU.
/// </summary>
public sealed class MapView : Control
{
    private const double KeyPanSpeed = 900; // DIPs per second
    private const double WheelStep = 1.2;
    private const double PreviewRefreshSeconds = 0.5;

    private static readonly SKColor Invalid = new(0xF0, 0x40, 0x38);
    private static readonly Typeface LabelFace = new(FontFamily.Default, FontStyle.Normal, FontWeight.SemiBold);

    private readonly FrameBuilder _frames = new();
    private readonly HashSet<Key> _held = [];
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private MapRenderer _renderer = new();
    private IMapHost? _host;
    private FrameSnapshot? _frame;
    private bool _attached;
    private bool _frameRequested;
    private double _lastFrameSeconds;
    private int _cameraGeneration = -1;

    private Point? _panLast;
    private double _panDistance;
    private (int X, int Y)? _dragStart;
    private (int X, int Y) _hover = (-1, -1);
    private Point _pointer;
    private ToolPreview? _preview;
    private (ToolKind Tool, int X0, int Y0, int X1, int Y1, int Generation) _previewKey;
    private double _previewAt = double.NegativeInfinity;

    static MapView()
    {
        FocusableProperty.OverrideDefaultValue<MapView>(true);
        ClipToBoundsProperty.OverrideDefaultValue<MapView>(true);
    }

    public Camera Camera { get; } = new();

    /// <summary>Zoom used when a new city is first framed (the <c>--zoom</c> option); null = fit the city.</summary>
    public double? InitialZoom { get; set; }

    public MapRenderer Renderer => _renderer;

    /// <summary>Last frame handed to the renderer (tests inspect it).</summary>
    public FrameSnapshot? CurrentFrame => _frame;

    public ToolPreview? Preview => _preview;

    public bool IsDragging => _dragStart is not null;

    protected override void OnDataContextChanged(EventArgs e)
    {
        base.OnDataContextChanged(e);
        if (_host is not null)
        {
            _host.CenterRequested -= OnCenterRequested;
            if (_host is System.ComponentModel.INotifyPropertyChanged old)
            {
                old.PropertyChanged -= OnHostPropertyChanged;
            }
        }

        _host = DataContext as IMapHost;
        if (_host is not null)
        {
            _host.CenterRequested += OnCenterRequested;
            if (_host is System.ComponentModel.INotifyPropertyChanged host)
            {
                host.PropertyChanged += OnHostPropertyChanged;
            }
        }

        RequestFrame();
    }

    /// <summary>Tool, overlay, selection, money or date changed: draw a new frame.</summary>
    private void OnHostPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => RequestFrame();

    /// <summary>True while the picture changes by itself and frames must keep coming.</summary>
    private bool HasMotion => _held.Count > 0 || _frame is { Paused: false };

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _attached = true;
        RequestFrame();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _attached = false;
        // The draw operation may still be queued on the render thread; the renderer's own lock makes
        // disposal wait for it. A fresh renderer is created if the view is attached again.
        _renderer.Dispose();
        _renderer = new MapRenderer();
    }

    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        Camera.ViewWidth = Math.Max(1, e.NewSize.Width);
        Camera.ViewHeight = Math.Max(1, e.NewSize.Height);
        RequestFrame();
    }

    /// <summary>Builds a frame now and invalidates (tests and the frame loop).</summary>
    public void RefreshFrame()
    {
        if (_host is null)
        {
            return;
        }

        double now = _clock.Elapsed.TotalSeconds;
        double dt = Math.Clamp(now - _lastFrameSeconds, 0, 0.1);
        _lastFrameSeconds = now;
        ApplyKeyPan(dt);
        if (_frames.Static is { } previous)
        {
            Camera.Clamp(previous.Width, previous.Height);
        }

        var started = Stopwatch.GetTimestamp();
        var runner = _host.Session.Runner;
        UpdatePreview(now);
        bool grid = _host.ActiveTool.Interaction is ToolInteraction.Rectangle or ToolInteraction.Place;
        _frame = _frames.Build(runner, Camera.View, _host.Overlay, _preview, _host.Selection, grid);
        _renderer.Stats.SnapshotMilliseconds = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        _renderer.Stats.StaleFrames = _frames.StaleFrames;

        if (_frame.Static.Generation != _cameraGeneration)
        {
            _cameraGeneration = _frame.Static.Generation;
            FrameCity(_frame.Static);
            _frame = _frames.Build(runner, Camera.View, _host.Overlay, _preview, _host.Selection, grid);
        }

        InvalidateVisual();
    }

    /// <summary>Makes the next frame show map changes immediately instead of at the throttled rate.</summary>
    public void RefreshStaticNow() => _frames.RefreshStaticNow();

    /// <summary>Screen point (control coordinates) of a tile's centre.</summary>
    public Point TileCenter(int x, int y)
    {
        var (sx, sy) = Camera.WorldToScreen(x + 0.5, y + 0.5);
        return new Point(sx, sy);
    }

    public (int X, int Y) TileAt(Point p)
    {
        var (wx, wy) = Camera.ScreenToWorld(p.X, p.Y);
        return ((int)Math.Floor(wx), (int)Math.Floor(wy));
    }

    /// <summary>Keyboard camera control and drag cancel. Returns true when the key was used.</summary>
    public bool HandleKeyDown(Key key)
    {
        switch (key)
        {
            case Key.W or Key.A or Key.S or Key.D or Key.Up or Key.Down or Key.Left or Key.Right:
                _held.Add(key);
                RequestFrame();
                return true;
            case Key.OemPlus or Key.Add:
                Camera.ZoomAt(Camera.ViewWidth / 2, Camera.ViewHeight / 2, 1.25);
                RequestFrame();
                return true;
            case Key.OemMinus or Key.Subtract:
                Camera.ZoomAt(Camera.ViewWidth / 2, Camera.ViewHeight / 2, 1 / 1.25);
                RequestFrame();
                return true;
            case Key.Escape when _dragStart is not null:
                CancelDrag();
                return true;
            default:
                return false;
        }
    }

    public void HandleKeyUp(Key key) => _held.Remove(key);

    /// <summary>Forgets held keys (window lost focus) so the camera does not keep drifting.</summary>
    public void ReleaseKeys() => _held.Clear();

    public override void Render(DrawingContext context)
    {
        if (_frame is null)
        {
            context.FillRectangle(new SolidColorBrush(Color.FromRgb(0x14, 0x1A, 0x22)), new Rect(Bounds.Size));
            return;
        }

        context.Custom(new MapDrawOperation(new Rect(Bounds.Size), _frame, _renderer));
        if (_preview is { Label.Length: > 0 } preview)
        {
            DrawLabel(context, preview);
        }
    }

    // ---------------------------------------------------------------- pointer input

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (_host is null)
        {
            return;
        }

        Focus();
        var point = e.GetCurrentPoint(this);
        _pointer = point.Position;
        var props = point.Properties;
        RequestFrame();
        if (props.IsRightButtonPressed || props.IsMiddleButtonPressed)
        {
            _panLast = point.Position;
            _panDistance = 0;
            e.Pointer.Capture(this);
            e.Handled = true;
            return;
        }

        if (!props.IsLeftButtonPressed)
        {
            return;
        }

        var tile = TileAt(point.Position);
        var tool = _host.ActiveTool;
        switch (tool.Interaction)
        {
            case ToolInteraction.Select:
                SelectAt(point.Position);
                break;
            case ToolInteraction.Path or ToolInteraction.Rectangle when InMap(tile):
                _dragStart = tile;
                _hover = tile;
                e.Pointer.Capture(this);
                InvalidatePreview();
                break;
        }

        e.Handled = true;
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        var position = e.GetPosition(this);
        RequestFrame();
        if (_panLast is { } last)
        {
            var delta = position - last;
            Camera.PanByScreen(delta.X, delta.Y);
            _panDistance += Math.Abs(delta.X) + Math.Abs(delta.Y);
            _panLast = position;
        }

        _pointer = position;
        var tile = ClampToMap(TileAt(position));
        if (tile != _hover)
        {
            _hover = tile;
            _host?.OnHover(tile.X, tile.Y);
        }
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        if (_host is null)
        {
            return;
        }

        var position = e.GetPosition(this);
        RequestFrame();
        if (e.InitialPressMouseButton is MouseButton.Right or MouseButton.Middle)
        {
            // A right click without dragging cancels a tool drag in progress.
            if (e.InitialPressMouseButton == MouseButton.Right && _panDistance < 4)
            {
                CancelDrag();
            }

            _panLast = null;
            e.Pointer.Capture(null);
            e.Handled = true;
            return;
        }

        if (e.InitialPressMouseButton != MouseButton.Left)
        {
            return;
        }

        var tool = _host.ActiveTool;
        var tile = ClampToMap(TileAt(position));
        if (_dragStart is { } start && tool.Interaction is ToolInteraction.Path or ToolInteraction.Rectangle)
        {
            Commit(tool, start.X, start.Y, tile.X, tile.Y);
            _dragStart = null;
        }
        else if (tool.Interaction == ToolInteraction.Place && InMap(TileAt(position)))
        {
            Commit(tool, tile.X, tile.Y, tile.X, tile.Y);
        }

        e.Pointer.Capture(null);
        e.Handled = true;
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        var p = e.GetPosition(this);
        Camera.ZoomAt(p.X, p.Y, Math.Pow(WheelStep, e.Delta.Y));
        RequestFrame();
        e.Handled = true;
    }

    protected override void OnPointerExited(PointerEventArgs e)
    {
        base.OnPointerExited(e);
        if (_dragStart is null)
        {
            _hover = (-1, -1);
            _host?.OnHover(-1, -1);
            RequestFrame();
        }
    }

    // ---------------------------------------------------------------- tools

    private void Commit(ToolDefinition tool, int x0, int y0, int x1, int y1)
    {
        if (_host is null || tool.CommandFor(x0, y0, x1, y1) is not { } command)
        {
            return;
        }

        var result = _host.Session.Runner.Execute(command);
        _frames.RefreshStaticNow();
        _host.OnCommandApplied(tool, result);
        InvalidatePreview();
    }

    private void CancelDrag()
    {
        _dragStart = null;
        InvalidatePreview();
    }

    private void InvalidatePreview() => _previewAt = double.NegativeInfinity;

    /// <summary>Re-estimates the active tool's command when its tiles change (or twice a second, as money changes).</summary>
    private void UpdatePreview(double now)
    {
        var tool = _host!.ActiveTool;
        if (tool.Interaction == ToolInteraction.Select || _hover.X < 0 || _frame is null && _frames.Static is null)
        {
            _preview = null;
            return;
        }

        var (x1, y1) = _hover;
        var (x0, y0) = _dragStart ?? _hover;
        int generation = _frames.Static?.Generation ?? 0;
        var key = (tool.Kind, x0, y0, x1, y1, generation);
        if (key == _previewKey && now - _previewAt < PreviewRefreshSeconds && _preview is not null)
        {
            _preview = _preview with { LabelX = _pointer.X, LabelY = _pointer.Y };
            return;
        }

        _previewKey = key;
        _previewAt = now;
        if (tool.CommandFor(x0, y0, x1, y1) is not { } command)
        {
            _preview = null;
            return;
        }

        var result = _host.Session.Runner.Estimate(command);
        _preview = new ToolPreview(tool.PreviewRects(x0, y0, x1, y1), result.Success ? tool.PreviewColour : Invalid,
            result.Success, PreviewLabel(tool, result), _pointer.X, _pointer.Y);
    }

    private static string PreviewLabel(ToolDefinition tool, Core.Engine.CommandResult result)
    {
        string cost = result.Cost > 0 ? Format.Money(result.Cost) : "free";
        if (!result.Success)
        {
            return result.Cost > 0 ? $"{result.Message} ({cost})" : result.Message;
        }

        return tool.Interaction switch
        {
            ToolInteraction.Place => $"{tool.Name}: {cost}",
            ToolInteraction.Rectangle when tool.Kind == ToolKind.Bulldoze => $"Bulldoze {result.TilesAffected} objects: {cost}",
            ToolInteraction.Rectangle => $"{tool.Name}: {result.TilesAffected} tiles, {cost}",
            _ => $"{tool.Name}: {result.TilesAffected} tiles, {cost}",
        };
    }

    private void SelectAt(Point position)
    {
        if (_host is null || _frames.Static is not { } s)
        {
            return;
        }

        var (wx, wy) = Camera.ScreenToWorld(position.X, position.Y);
        int tx = (int)Math.Floor(wx);
        int ty = (int)Math.Floor(wy);

        // Vehicles first: they sit on top of everything.
        if (_frame is { } frame)
        {
            float t = frame.InterpolationAt(Stopwatch.GetTimestamp());
            int best = 0;
            double bestDistance = Math.Max(0.35, 6 / Camera.Zoom);
            for (int i = 0; i < frame.VehicleCount; i++)
            {
                var (vx, vy, _) = frame.Vehicles[i].Evaluate(t);
                double d = Math.Sqrt((vx - wx) * (vx - wx) + (vy - wy) * (vy - wy));
                if (d < bestDistance)
                {
                    bestDistance = d;
                    best = frame.Vehicles[i].Id;
                }
            }

            if (best > 0)
            {
                _host.Select(new MapSelection(SelectionKind.Vehicle, best, -1));
                return;
            }
        }

        if (!InMap((tx, ty)))
        {
            _host.Select(MapSelection.None);
            return;
        }

        int tile = ty * s.Width + tx;
        if (s.BuildingAt[tile] is var id and > 0)
        {
            _host.Select(new MapSelection(SelectionKind.Building, id, tile));
        }
        else if (s.Roads[tile] != RoadType.None)
        {
            _host.Select(new MapSelection(SelectionKind.Road, 0, tile));
        }
        else
        {
            _host.Select(new MapSelection(SelectionKind.Tile, 0, tile));
        }
    }

    // ---------------------------------------------------------------- camera

    /// <summary>Schedules one frame on the next animation tick (no-op if one is already scheduled).</summary>
    public void RequestFrame()
    {
        if (_frameRequested || !_attached || TopLevel.GetTopLevel(this) is not { } top)
        {
            return;
        }

        _frameRequested = true;
        top.RequestAnimationFrame(_ =>
        {
            _frameRequested = false;
            if (!_attached)
            {
                return;
            }

            RefreshFrame();
            if (HasMotion)
            {
                RequestFrame();
            }
        });
    }

    private void ApplyKeyPan(double dt)
    {
        if (_held.Count == 0 || dt <= 0)
        {
            return;
        }

        double dx = 0;
        double dy = 0;
        foreach (var key in _held)
        {
            switch (key)
            {
                case Key.W or Key.Up: dy += 1; break;
                case Key.S or Key.Down: dy -= 1; break;
                case Key.A or Key.Left: dx += 1; break;
                case Key.D or Key.Right: dx -= 1; break;
            }
        }

        Camera.PanByScreen(dx * KeyPanSpeed * dt, dy * KeyPanSpeed * dt);
    }

    /// <summary>On a new city: centre on its roads (the demo city) or on the middle of the map.</summary>
    private void FrameCity(StaticSnapshot s)
    {
        FrameCityExtent(s);
        if (InitialZoom is { } zoom)
        {
            Camera.Zoom = zoom;
        }
    }

    private void FrameCityExtent(StaticSnapshot s)
    {
        int minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1;
        for (int y = 0; y < s.Height; y++)
        {
            for (int x = 0; x < s.Width; x++)
            {
                if (s.Roads[y * s.Width + x] != RoadType.None)
                {
                    minX = Math.Min(minX, x);
                    minY = Math.Min(minY, y);
                    maxX = Math.Max(maxX, x);
                    maxY = Math.Max(maxY, y);
                }
            }
        }

        if (maxX < 0)
        {
            Camera.Fit(s.Width, s.Height);
            Camera.Zoom = Math.Max(Camera.Zoom, 9);
            return;
        }

        Camera.CenterOn((minX + maxX + 1) / 2.0, (minY + maxY + 1) / 2.0);
        double fit = Math.Min(Camera.ViewWidth / (maxX - minX + 6), Camera.ViewHeight / (maxY - minY + 6));
        Camera.Zoom = Math.Clamp(fit, 6, 24);
    }

    private void OnCenterRequested(int x, int y)
    {
        Camera.CenterOn(x + 0.5, y + 0.5);
        Camera.Zoom = Math.Max(Camera.Zoom, 16);
        RequestFrame();
    }

    private bool InMap((int X, int Y) tile) =>
        _frames.Static is { } s && (uint)tile.X < (uint)s.Width && (uint)tile.Y < (uint)s.Height;

    private (int X, int Y) ClampToMap((int X, int Y) tile) => _frames.Static is { } s
        ? (Math.Clamp(tile.X, 0, s.Width - 1), Math.Clamp(tile.Y, 0, s.Height - 1))
        : tile;

    private void DrawLabel(DrawingContext context, ToolPreview preview)
    {
        var text = new FormattedText(preview.Label, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, LabelFace, 13,
            Brushes.White);
        double x = Math.Min(preview.LabelX + 18, Bounds.Width - text.Width - 14);
        double y = Math.Min(preview.LabelY + 18, Bounds.Height - text.Height - 12);
        var box = new Rect(x - 7, y - 4, text.Width + 14, text.Height + 8);
        var background = preview.Valid ? Color.FromArgb(0xE0, 0x1C, 0x24, 0x2E) : Color.FromArgb(0xE8, 0x7A, 0x1C, 0x18);
        context.DrawRectangle(new SolidColorBrush(background), null, box, 5, 5);
        context.DrawText(text, new Point(x, y));
    }
}
