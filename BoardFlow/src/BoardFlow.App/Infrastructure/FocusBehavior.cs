using System.Runtime.CompilerServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Threading;
using Avalonia.VisualTree;

namespace BoardFlow.App.Infrastructure;

/// <summary>
/// <c>FocusBehavior.FocusWhenVisible="True"</c> focuses (and selects the text of) a control whenever it
/// becomes visible: when it is attached to the window, or when it or any ancestor switches IsVisible on.
/// Dialogs, the card editor and quick-add boxes are then ready for typing without a click.
/// </summary>
public sealed class FocusBehavior : AvaloniaObject
{
    public static readonly AttachedProperty<bool> FocusWhenVisibleProperty =
        AvaloniaProperty.RegisterAttached<FocusBehavior, Control, bool>("FocusWhenVisible");

    private static readonly ConditionalWeakTable<Control, Subscription> Subscriptions = [];

    static FocusBehavior()
    {
        FocusWhenVisibleProperty.Changed.AddClassHandler<Control>((control, e) =>
        {
            if (e.NewValue is true)
            {
                control.AttachedToVisualTree += OnAttached;
                control.DetachedFromVisualTree += OnDetached;
            }
        });
    }

    public static bool GetFocusWhenVisible(Control control) => control.GetValue(FocusWhenVisibleProperty);

    public static void SetFocusWhenVisible(Control control, bool value) => control.SetValue(FocusWhenVisibleProperty, value);

    private static void OnAttached(object? sender, VisualTreeAttachmentEventArgs e)
    {
        var control = (Control)sender!;
        Unsubscribe(control);

        EventHandler<AvaloniaPropertyChangedEventArgs> handler = (_, args) =>
        {
            if (args.Property == Visual.IsVisibleProperty && args.NewValue is true)
            {
                FocusIfVisible(control);
            }
        };
        var chain = new List<Visual>();
        for (Visual? visual = control; visual is not null and not TopLevel; visual = visual.GetVisualParent())
        {
            visual.PropertyChanged += handler;
            chain.Add(visual);
        }

        Subscriptions.AddOrUpdate(control, new Subscription(chain, handler));
        FocusIfVisible(control);
    }

    private static void OnDetached(object? sender, VisualTreeAttachmentEventArgs e) => Unsubscribe((Control)sender!);

    private static void Unsubscribe(Control control)
    {
        if (Subscriptions.TryGetValue(control, out var subscription))
        {
            foreach (var visual in subscription.Chain)
            {
                visual.PropertyChanged -= subscription.Handler;
            }

            Subscriptions.Remove(control);
        }
    }

    private static void FocusIfVisible(Control control) =>
        Dispatcher.UIThread.Post(() =>
        {
            if (control.IsEffectivelyVisible && control.IsAttachedToVisualTree())
            {
                control.Focus(NavigationMethod.Tab);
                if (control is TextBox textBox)
                {
                    textBox.SelectAll();
                }
            }
        }, DispatcherPriority.Loaded);

    private sealed record Subscription(List<Visual> Chain, EventHandler<AvaloniaPropertyChangedEventArgs> Handler);
}
