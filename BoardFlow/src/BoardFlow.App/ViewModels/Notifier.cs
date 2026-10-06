using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels;

/// <summary>The single toast/banner at the bottom of the window. A newer message replaces an older one.</summary>
public sealed partial class Notifier : ObservableObject
{
    private int _version;

    [ObservableProperty]
    public partial string? Message { get; private set; }

    [ObservableProperty]
    public partial bool IsError { get; private set; }

    [ObservableProperty]
    public partial bool IsVisible { get; private set; }

    public void Info(string message) => Show(message, isError: false, TimeSpan.FromSeconds(4));

    /// <summary>Errors stay up longer so there is time to read them.</summary>
    public void Error(string message) => Show(message, isError: true, TimeSpan.FromSeconds(10));

    [RelayCommand]
    public void Dismiss()
    {
        _version++;
        IsVisible = false;
    }

    private async void Show(string message, bool isError, TimeSpan duration)
    {
        var version = ++_version;
        Message = message;
        IsError = isError;
        IsVisible = true;
        await Task.Delay(duration);
        if (version == _version)
        {
            IsVisible = false;
        }
    }
}
