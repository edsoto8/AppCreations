namespace TaskFlow.Controls;

public sealed partial class PriorityBadge : UserControl
{
    /// <summary>
    /// A DependencyProperty is a property the XAML engine understands: it can be bound, styled and animated.
    /// The callback runs whenever the value changes, so the badge always matches the bound task.
    /// </summary>
    public static readonly DependencyProperty PriorityProperty = DependencyProperty.Register(
        nameof(Priority),
        typeof(Priority),
        typeof(PriorityBadge),
        new PropertyMetadata(Priority.Medium, (d, _) => ((PriorityBadge)d).UpdateState()));

    public PriorityBadge()
    {
        this.InitializeComponent();
        UpdateState();
    }

    public Priority Priority
    {
        get => (Priority)GetValue(PriorityProperty);
        set => SetValue(PriorityProperty, value);
    }

    private void UpdateState()
    {
        Label.Text = Priority.ToString();
        AutomationProperties.SetName(this, $"{Priority} priority");
        VisualStateManager.GoToState(this, Priority.ToString(), useTransitions: false);
    }
}
