using System.IO;
using System.Windows;
using Microsoft.Win32;
using StepRecorder.Core.Settings;

namespace StepRecorder.App;

/// <summary>
/// Settings shell. Only settings that already do something are shown; later milestones add theirs.
/// </summary>
public partial class SettingsWindow : Window
{
    private readonly RecorderSettings original;
    private readonly string defaultFolder;
    private readonly Func<RecorderSettings, string?> save;

    /// <param name="save">Persists the new settings and returns an error message, or null on success.</param>
    internal SettingsWindow(RecorderSettings settings, string defaultFolder, Func<RecorderSettings, string?> save)
    {
        InitializeComponent();
        original = settings;
        this.defaultFolder = defaultFolder;
        this.save = save;

        FolderBox.Text = string.IsNullOrWhiteSpace(settings.Storage.RecordingsDirectory)
            ? defaultFolder
            : settings.Storage.RecordingsDirectory;
        FolderHint.Text = $"Each recording gets its own sub-folder here. Leave empty to use {defaultFolder}.";
        NameBox.Text = settings.Storage.DefaultSessionName;
        HtmlBox.IsChecked = settings.Reports.GenerateHtml;
        MarkdownBox.IsChecked = settings.Reports.GenerateMarkdown;
    }

    private void Browse_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = "Choose the recordings folder" };
        if (Directory.Exists(FolderBox.Text))
        {
            dialog.InitialDirectory = FolderBox.Text;
        }

        if (dialog.ShowDialog(this) == true)
        {
            FolderBox.Text = dialog.FolderName;
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        string folder = FolderBox.Text.Trim();
        if (folder.Length > 0 && !Path.IsPathFullyQualified(folder))
        {
            ShowError("The recordings folder must be a full path, such as C:\\Recordings.");
            FolderBox.Focus();
            return;
        }

        // Keep "empty" while the user sticks with the default, so the default can follow Documents if it moves.
        if (string.Equals(folder, defaultFolder, StringComparison.OrdinalIgnoreCase))
        {
            folder = "";
        }

        bool html = HtmlBox.IsChecked == true;
        bool markdown = MarkdownBox.IsChecked == true;
        if (!html && !markdown)
        {
            ShowError("Choose at least one report format.");
            HtmlBox.Focus();
            return;
        }

        string name = NameBox.Text.Trim();
        RecorderSettings updated = original with
        {
            Storage = original.Storage with
            {
                RecordingsDirectory = folder,
                DefaultSessionName = name.Length == 0 ? StorageSettings.DefaultName : name,
            },
            Reports = original.Reports with { GenerateHtml = html, GenerateMarkdown = markdown },
        };

        if (save(updated) is { } error)
        {
            ShowError(error);
            return;
        }

        Close();
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
    }
}
