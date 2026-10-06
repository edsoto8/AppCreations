using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels;

/// <summary>A side panel (card editor, archive, labels). Panels can veto closing, e.g. to confirm discarding edits.</summary>
public interface IPanel
{
    Task<bool> CanCloseAsync();
}

/// <summary>Shows at most one side panel at a time.</summary>
public sealed partial class PanelHost : ObservableObject
{
    [ObservableProperty]
    public partial IPanel? Current { get; private set; }

    /// <summary>Opens <paramref name="panel"/> unless the current panel refuses to close.</summary>
    public async Task<bool> OpenAsync(IPanel panel)
    {
        if (!await CloseAsync())
        {
            return false;
        }

        Current = panel;
        return true;
    }

    /// <summary>Closes the current panel if it agrees. Returns false only when the panel vetoed.</summary>
    public async Task<bool> CloseAsync()
    {
        if (Current is { } current && !await current.CanCloseAsync())
        {
            return false;
        }

        Current = null;
        return true;
    }

    /// <summary>Closes without asking, used after the panel itself has saved or discarded.</summary>
    public void ForceClose(IPanel panel)
    {
        if (ReferenceEquals(Current, panel))
        {
            Current = null;
        }
    }
}
