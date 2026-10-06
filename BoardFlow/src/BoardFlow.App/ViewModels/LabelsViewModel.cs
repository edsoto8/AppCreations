using System.Collections.ObjectModel;
using BoardFlow.Core.Domain;
using BoardFlow.Core.Rules;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BoardFlow.App.ViewModels;

public sealed partial class LabelRowViewModel(Label label, int usage) : ObservableObject
{
    public long Id { get; } = label.Id;

    public string SavedName { get; } = label.Name;

    public string SavedColor { get; } = label.DisplayColor;

    public string UsageText { get; } = usage == 1 ? "1 card" : $"{usage} cards";

    public int Usage { get; } = usage;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsChanged))]
    public partial string Name { get; set; } = label.Name;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsChanged))]
    public partial string Color { get; set; } = label.DisplayColor;

    public bool IsChanged => Name != SavedName || !string.Equals(Color, SavedColor, StringComparison.OrdinalIgnoreCase);
}

/// <summary>Create, rename, recolour and delete the labels of a workspace.</summary>
public sealed partial class LabelsViewModel : ViewModelBase, IPanel
{
    private readonly long _workspaceId;
    private readonly Action _changed;

    public LabelsViewModel(BoardServices services, long workspaceId, string workspaceName, Action changed)
        : base(services)
    {
        _workspaceId = workspaceId;
        _changed = changed;
        WorkspaceName = workspaceName;
        NewColor = LabelColors.Palette[0];
        Load();
    }

    public string WorkspaceName { get; }

    public IReadOnlyList<string> Palette => LabelColors.Palette;

    public ObservableCollection<LabelRowViewModel> Labels { get; } = [];

    [ObservableProperty]
    public partial bool IsEmpty { get; private set; }

    [ObservableProperty]
    public partial string NewName { get; set; } = "";

    [ObservableProperty]
    public partial string NewColor { get; set; }

    public Task<bool> CanCloseAsync() => Task.FromResult(true);

    [RelayCommand]
    private async Task Close() => await Services.Panels.CloseAsync();

    [RelayCommand]
    private void Add()
    {
        if (Try(() => Services.Labels.Create(_workspaceId, NewName, NewColor), "create the label"))
        {
            NewName = "";
            NewColor = Palette[(Labels.Count + 1) % Palette.Count];
            Refresh();
        }
    }

    [RelayCommand]
    private void Save(LabelRowViewModel row)
    {
        if (Try(() => Services.Labels.Update(row.Id, row.Name, row.Color), "save the label"))
        {
            Refresh();
        }
    }

    [RelayCommand]
    private async Task Delete(LabelRowViewModel row)
    {
        var message = row.Usage == 0
            ? $"Delete the label '{row.SavedName}'?"
            : $"'{row.SavedName}' is on {row.UsageText}. Deleting it removes it from those cards; the cards themselves are kept.";
        if (await Services.Dialogs.ConfirmAsync("Delete label?", message, "Delete label", isDestructive: true)
            && Try(() => Services.Labels.Delete(row.Id), "delete the label"))
        {
            Refresh();
        }
    }

    protected override void OnStaleData() => Refresh();

    private void Refresh()
    {
        Load();
        _changed();
    }

    private void Load() => Try(() =>
    {
        Labels.Clear();
        foreach (var label in Services.Labels.GetByWorkspace(_workspaceId))
        {
            Labels.Add(new LabelRowViewModel(label, Services.Labels.CountUsage(label.Id)));
        }

        IsEmpty = Labels.Count == 0;
    }, "load the labels");
}
