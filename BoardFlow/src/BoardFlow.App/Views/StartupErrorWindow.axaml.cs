using Avalonia.Controls;
using BoardFlow.App.Infrastructure;

namespace BoardFlow.App.Views;

/// <summary>Shown instead of the main window when the database cannot be used. It never touches the file.</summary>
public sealed partial class StartupErrorWindow : Window
{
    public StartupErrorWindow()
    {
        InitializeComponent();
        CloseButton.Click += (_, _) => Close();
    }

    public StartupErrorWindow(string message, AppPaths paths)
        : this()
    {
        MessageText.Text = message;
        PathsText.Text = $"Database: {paths.DatabasePath}\nLogs: {paths.LogDirectory}";
    }
}
