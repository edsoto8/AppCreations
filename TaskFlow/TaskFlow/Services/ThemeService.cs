using Windows.Storage;

namespace TaskFlow.Services;

public enum AppTheme
{
    System,
    Light,
    Dark,
}

/// <summary>
/// Switches between the system theme, Light and Dark, and remembers the choice in LocalSettings
/// (a small key/value store that Uno provides on every platform).
/// </summary>
public sealed class ThemeService
{
    private const string SettingKey = "AppTheme";
    private FrameworkElement? _root;

    public ThemeService()
    {
        Current = ReadSetting();
    }

    public AppTheme Current { get; private set; }

    /// <summary>Applies the saved theme to the window's root element. Everything inside inherits it.</summary>
    public void Attach(FrameworkElement root)
    {
        _root = root;
        Apply();
    }

    /// <summary>System → Light → Dark → System …</summary>
    public AppTheme Cycle()
    {
        Current = Current switch
        {
            AppTheme.System => AppTheme.Light,
            AppTheme.Light => AppTheme.Dark,
            _ => AppTheme.System,
        };
        Apply();
        SaveSetting(Current);
        return Current;
    }

    /// <summary>The theme the root currently uses, for popups (such as dialogs) that don't inherit it.</summary>
    public ElementTheme ElementTheme => _root?.RequestedTheme ?? ElementTheme.Default;

    private void Apply()
    {
        if (_root is not null)
        {
            _root.RequestedTheme = Current switch
            {
                AppTheme.Light => ElementTheme.Light,
                AppTheme.Dark => ElementTheme.Dark,
                _ => ElementTheme.Default, // follow the operating system
            };
        }
    }

    private static AppTheme ReadSetting()
    {
        try
        {
            return ApplicationData.Current.LocalSettings.Values[SettingKey] is string value
                && Enum.TryParse<AppTheme>(value, out var theme)
                ? theme
                : AppTheme.System;
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return AppTheme.System; // a missing or broken settings store must not stop the app
        }
    }

    private static void SaveSetting(AppTheme theme)
    {
        try
        {
            ApplicationData.Current.LocalSettings.Values[SettingKey] = theme.ToString();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            // Not worth bothering the user about; the theme still applies for this session.
        }
    }
}
