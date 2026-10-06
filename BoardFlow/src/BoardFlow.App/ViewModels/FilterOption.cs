using CommunityToolkit.Mvvm.ComponentModel;

namespace BoardFlow.App.ViewModels;

/// <summary>A toggle in the filter flyout (a priority, label or column).</summary>
public sealed partial class FilterOption(long key, string name, string? color, Action changed) : ObservableObject
{
    public long Key { get; } = key;

    public string Name { get; } = name;

    public string? Color { get; } = color;

    public bool HasColor => Color is not null;

    [ObservableProperty]
    public partial bool IsSelected { get; set; }

    partial void OnIsSelectedChanged(bool value) => changed();
}

public sealed record DueFilterOption(BoardFlow.Core.Rules.DueFilter Value, string Name);
