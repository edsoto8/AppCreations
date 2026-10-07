using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Input;
using Avalonia.VisualTree;
using BoardFlow.App.ViewModels;

namespace BoardFlow.Tests.App.Support;

public static class UiHelpers
{
    public static Button CardButton(this Window window, long cardId) =>
        window.GetVisualDescendants().OfType<Button>()
            .Single(b => b.Classes.Contains("card") && b.DataContext is CardItemViewModel c && c.Id == cardId);

    public static Control ColumnHeader(this Window window, long columnId) =>
        window.GetVisualDescendants().OfType<Border>()
            .Single(b => b.Name == "ColumnHeader" && b.DataContext is ColumnViewModel c && c.Id == columnId);

    public static Control ColumnBody(this Window window, long columnId) =>
        window.GetVisualDescendants().OfType<Border>()
            .Single(b => b.Classes.Contains("column") && b.DataContext is ColumnViewModel c && c.Id == columnId);

    public static T Named<T>(this Window window, string name)
        where T : Control =>
        window.GetVisualDescendants().OfType<T>().First(c => c.Name == name);

    /// <summary>A point inside <paramref name="control"/>, in window coordinates (fractions of its size).</summary>
    public static Point At(this Control control, Window window, double fx = 0.5, double fy = 0.5) =>
        control.TranslatePoint(new Point(control.Bounds.Width * fx, control.Bounds.Height * fy), window)
        ?? throw new InvalidOperationException("Control is not in the window.");

    /// <summary>Presses at <paramref name="from"/>, moves in steps to <paramref name="to"/>, releases.</summary>
    public static void Drag(this Window window, Point from, Point to, int steps = 6)
    {
        window.MouseDown(from, MouseButton.Left);
        TestSession.Pump();
        for (var i = 1; i <= steps; i++)
        {
            window.MouseMove(from + ((to - from) * i / steps), RawInputModifiers.LeftMouseButton);
            TestSession.Pump();
        }

        window.MouseUp(to, MouseButton.Left);
        TestSession.Pump();
    }

    public static void Click(this Window window, Point at)
    {
        window.MouseDown(at, MouseButton.Left);
        window.MouseUp(at, MouseButton.Left);
        TestSession.Pump();
    }
}
