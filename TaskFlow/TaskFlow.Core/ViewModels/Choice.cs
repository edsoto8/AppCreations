namespace TaskFlow.Core.ViewModels;

/// <summary>
/// One entry in a ComboBox or RadioButtons list: the value the view model cares about plus the text the user sees.
/// ComboBox shows <see cref="ToString"/> when no template is given, so overriding it is all the UI needs.
/// </summary>
public sealed record Choice<T>(T Value, string Label)
{
    public override string ToString() => Label;
}
