using BoardFlow.Core.Domain;

namespace BoardFlow.App.ViewModels;

/// <summary>A label as shown on a card or in a picker.</summary>
public sealed record LabelChip(long Id, string Name, string Color)
{
    public static LabelChip From(Label label) => new(label.Id, label.Name, label.DisplayColor);
}
