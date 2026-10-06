using System.Runtime.InteropServices;
using System.Windows.Automation;
using StepRecorder.Core.Automation;
using StepRecorder.Core.Sessions;

namespace StepRecorder.Windows;

/// <summary>
/// Finds the control under a click with Windows UI Automation (System.Windows.Automation). All
/// properties are fetched in one cached request per element to keep cross-process calls few. Only
/// identifying properties are read; values (text, passwords) are never requested.
/// Runs on a worker thread with a timeout (see <c>ClickRecorder</c>), because UI Automation calls block
/// while the target app is busy.
/// </summary>
public sealed class UiaElementInspector : IUiElementInspector
{
    private const int MaxMenuDepth = 8;

    private static readonly CacheRequest Properties = CreateCacheRequest();

    public UiElementInfo? GetElementAt(int x, int y)
    {
        AutomationElement? element;
        try
        {
            using (Properties.Activate())
            {
                // Physical pixels: the process is Per-Monitor V2 DPI aware, like UI Automation's own coordinates.
                element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
            }
        }
        catch (Exception ex) when (ex is ElementNotAvailableException or COMException or InvalidOperationException)
        {
            return null;
        }

        if (element is null)
        {
            return null;
        }

        AutomationElement.AutomationElementInformation info = element.Cached;
        string? controlType = ShortName(info.ControlType);

        return new UiElementInfo(
            Name: info.Name,
            ControlType: controlType,
            LocalizedControlType: info.LocalizedControlType,
            AutomationId: info.AutomationId,
            Bounds: ToScreenRect(info.BoundingRectangle),
            IsPassword: info.IsPassword,
            MenuPath: controlType == "MenuItem" ? MenuPath(element, info.Name) : null);
    }

    private static CacheRequest CreateCacheRequest()
    {
        var request = new CacheRequest { TreeScope = TreeScope.Element };
        request.Add(AutomationElement.NameProperty);
        request.Add(AutomationElement.ControlTypeProperty);
        request.Add(AutomationElement.LocalizedControlTypeProperty);
        request.Add(AutomationElement.AutomationIdProperty);
        request.Add(AutomationElement.BoundingRectangleProperty);
        request.Add(AutomationElement.IsPasswordProperty);
        return request;
    }

    /// <summary>
    /// "File > Export": names of the menu items (and named menus) above a menu item, from the top down.
    /// Win32 popup menus are named after the item that opened them. Some frameworks (WinUI flyouts)
    /// don't link popups to their parent item, in which case the path is just the item itself.
    /// </summary>
    private static IReadOnlyList<string> MenuPath(AutomationElement item, string itemName)
    {
        var names = new List<string> { itemName };
        try
        {
            using (Properties.Activate())
            {
                AutomationElement? current = TreeWalker.ControlViewWalker.GetParent(item, Properties);
                for (int depth = 0; current is not null && depth < MaxMenuDepth; depth++)
                {
                    string? type = ShortName(current.Cached.ControlType);
                    if (type is not ("MenuItem" or "Menu"))
                    {
                        break;
                    }

                    string name = current.Cached.Name;
                    if (!string.IsNullOrWhiteSpace(name) && !string.Equals(name, names[^1], StringComparison.Ordinal))
                    {
                        names.Add(name);
                    }

                    current = TreeWalker.ControlViewWalker.GetParent(current, Properties);
                }
            }
        }
        catch (Exception ex) when (ex is ElementNotAvailableException or COMException or InvalidOperationException)
        {
            // The menu closed while we walked it; keep what we have.
        }

        names.Reverse();
        return names;
    }

    private static string? ShortName(ControlType? type) =>
        type?.ProgrammaticName is { } name ? name[(name.LastIndexOf('.') + 1)..] : null;

    private static ScreenRect? ToScreenRect(System.Windows.Rect rect)
    {
        if (rect.IsEmpty || double.IsInfinity(rect.Width) || double.IsInfinity(rect.Height) || rect.Width <= 0 || rect.Height <= 0)
        {
            return null;
        }

        return new ScreenRect(
            (int)Math.Round(rect.X),
            (int)Math.Round(rect.Y),
            (int)Math.Round(rect.Width),
            (int)Math.Round(rect.Height));
    }
}
