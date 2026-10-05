using Microsoft.AspNetCore.Components;
using Microsoft.JSInterop;
using SkyHop.Core;
using SkyHop.Web.Services;

namespace SkyHop.Web.Components;

/// <summary>
/// Hosts the game. JavaScript owns the frame loop, drawing, audio and raw input; each frame it calls
/// <see cref="Tick"/> and draws the returned snapshot. Input arrives as named actions through <see cref="OnAction"/>.
/// The Razor markup only renders the overlays (start, pause, game over), which change rarely.
/// </summary>
public partial class GameView : IAsyncDisposable
{
    private const string MutedKey = "skyhop.muted";

    private readonly GameSnapshot _snapshot = new();
    private readonly List<GameEvent> _events = [];
    private ElementReference _frame;
    private Game _game = null!;
    private BrowserStorage _storage = null!;
    private IJSObjectReference? _module;
    private IJSObjectReference? _loop;
    private DotNetObjectReference<GameView>? _selfRef;
    private bool _muted;
    private bool _debug;
    private string _overlayKey = "";

    [Inject] private IJSRuntime JS { get; set; } = null!;
    [Inject] private NavigationManager Navigation { get; set; } = null!;

    private GameState State => _game.State;

    protected override void OnInitialized()
    {
        _storage = new BrowserStorage((IJSInProcessRuntime)JS);
        _game = new Game(GameConfig.Default, new LocalStorageHighScoreStore(_storage), new SystemRandomSource());
        _muted = _storage.Get(MutedKey) == "1";
        _debug = new Uri(Navigation.Uri).Query.Contains("debug=1", StringComparison.OrdinalIgnoreCase);
        _overlayKey = OverlayKey();
    }

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender)
        {
            return;
        }

        var config = _game.Config;
        _module = await JS.InvokeAsync<IJSObjectReference>("import", "./js/main.js");
        _selfRef = DotNetObjectReference.Create(this);
        _loop = await _module.InvokeAsync<IJSObjectReference>("start", _frame, _selfRef, new
        {
            worldWidth = config.World.Width,
            worldHeight = config.World.Height,
            groundY = config.World.GroundY,
            playerRadius = config.Player.VisualRadius,
            playerHitboxRadius = config.Player.HitboxRadius,
            obstacleHitboxInset = config.Obstacles.HitboxInset,
        });
    }

    /// <summary>Called by the JS frame loop once per animation frame.</summary>
    [JSInvokable]
    public GameSnapshot Tick(double frameSeconds)
    {
        _game.Update(frameSeconds);

        _events.Clear();
        _game.DrainEvents(_events);
        _snapshot.Fill(_game, _events, _muted, _debug);

        RefreshOverlayIfChanged();
        return _snapshot;
    }

    /// <summary>Receives device-independent actions from the JS input layer.</summary>
    [JSInvokable]
    public void OnAction(string action)
    {
        switch (action)
        {
            case "Flap":
                _game.Handle(InputAction.Flap);
                break;
            case "TogglePause":
                _game.Handle(InputAction.TogglePause);
                break;
            case "ToggleMute":
                ToggleMute();
                break;
            case "ToggleDebug":
                _debug = !_debug;
                break;
        }

        RefreshOverlayIfChanged();
    }

    /// <summary>The window lost focus or the tab was hidden: never let the player die while away.</summary>
    [JSInvokable]
    public void OnFocusLost()
    {
        _game.Pause();
        RefreshOverlayIfChanged();
    }

    private void Pause() => _game.Pause();

    private void Resume() => _game.Resume();

    private void Restart() => _game.Restart();

    private void ToggleMute()
    {
        _muted = !_muted;
        _storage.Set(MutedKey, _muted ? "1" : "0");
    }

    private string OverlayKey() => $"{State}|{_game.CanRestart}|{_muted}";

    private void RefreshOverlayIfChanged()
    {
        var key = OverlayKey();
        if (key != _overlayKey)
        {
            _overlayKey = key;
            StateHasChanged();
        }
    }

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (_loop is not null)
            {
                await _loop.InvokeVoidAsync("dispose");
                await _loop.DisposeAsync();
            }

            if (_module is not null)
            {
                await _module.DisposeAsync();
            }
        }
        catch (JSDisconnectedException)
        {
            // The page is going away; nothing left to clean up.
        }

        _selfRef?.Dispose();
    }
}
