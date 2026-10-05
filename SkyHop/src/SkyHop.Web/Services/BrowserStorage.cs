using Microsoft.JSInterop;
using SkyHop.Core;

namespace SkyHop.Web.Services;

/// <summary>
/// Synchronous access to browser localStorage through the small <c>skyhopStorage</c> helper in index.html,
/// which swallows the errors private browsing or blocked storage can throw.
/// </summary>
public sealed class BrowserStorage(IJSInProcessRuntime js)
{
    public string? Get(string key) => js.Invoke<string?>("skyhopStorage.get", key);

    public void Set(string key, string value) => js.InvokeVoid("skyhopStorage.set", key, value);
}

/// <summary>Keeps the best score in localStorage so it survives restarts, reloads and closing the browser.</summary>
public sealed class LocalStorageHighScoreStore(BrowserStorage storage) : IHighScoreStore
{
    public const string Key = "skyhop.best";

    public int Load() => int.TryParse(storage.Get(Key), out var best) && best > 0 ? best : 0;

    public void Save(int score) => storage.Set(Key, score.ToString(System.Globalization.CultureInfo.InvariantCulture));
}
