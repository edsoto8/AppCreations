using MetroSim.App.Game;
using MetroSim.App.Rendering;
using MetroSim.App.Tools;
using MetroSim.Core.Engine;

namespace MetroSim.App.Controls;

/// <summary>What the <see cref="MapView"/> needs from the rest of the UI (the main view model).</summary>
public interface IMapHost
{
    GameSession Session { get; }

    ToolDefinition ActiveTool { get; }

    OverlayKind Overlay { get; }

    MapSelection Selection { get; }

    void Select(MapSelection selection);

    /// <summary>Reports the outcome of a command the map issued (status line, refresh).</summary>
    void OnCommandApplied(ToolDefinition tool, CommandResult result);

    /// <summary>Tile under the pointer, or (-1, -1) when the pointer left the map.</summary>
    void OnHover(int x, int y);

    /// <summary>Raised when something (the event log) wants the map centred on a tile.</summary>
    event Action<int, int>? CenterRequested;
}
