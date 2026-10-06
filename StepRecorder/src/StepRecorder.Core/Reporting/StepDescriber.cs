using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;

namespace StepRecorder.Core.Reporting;

/// <summary>A piece of a description. Emphasized runs are names (controls, windows), shown in bold.</summary>
public readonly record struct TextRun(string Text, bool Emphasis = false);

/// <summary>A step description as runs, so each report format can render emphasis its own way.</summary>
public sealed record StepDescription(IReadOnlyList<TextRun> Runs)
{
    /// <summary>The description as plain text, with emphasized names in quotes.</summary>
    public string PlainText => string.Concat(Runs.Select(r => r.Emphasis ? $"\"{r.Text}\"" : r.Text));
}

/// <summary>
/// Turns a step into an instruction. In order of preference:
/// <list type="number">
/// <item>a stored <see cref="Step.GeneratedDescription"/> (user edits, Milestone 7; AI, Milestone 10);</item>
/// <item>the UI Automation control: <c>Click the **Save** button in **Invoice Editor**.</c>;</item>
/// <item>desktop/taskbar wording;</item>
/// <item>coordinates: <c>Click at (412, 218) in **Title**.</c></item>
/// </list>
/// Descriptions are written as instructions ("Click …"), so a report reads as reproduction steps.
/// </summary>
public static class StepDescriber
{
    public const string UnknownApplication = "Unknown application";

    /// <summary>Longer names (some list items and documents use their whole text) are shortened.</summary>
    public const int MaxNameLength = 80;

    public static string Describe(Step step) => DescribeRuns(step).PlainText;

    public static StepDescription DescribeRuns(Step step)
    {
        if (!string.IsNullOrWhiteSpace(step.GeneratedDescription))
        {
            return new StepDescription([new TextRun(step.GeneratedDescription.Trim())]);
        }

        string verb = Verb(step);
        bool plainLeftClick = (step.MouseButton is null or MouseButton.Left) && (step.ClickCount is null or <= 1);

        if (DescribeControl(step, verb, plainLeftClick) is { } control)
        {
            return control;
        }

        if (ShellWindows.IsDesktop(step.WindowClassName))
        {
            return Plain($"{verb} on the desktop.");
        }

        if (ShellWindows.IsTaskbarOrTray(step.WindowClassName))
        {
            return Plain($"{verb} on the taskbar.");
        }

        if (step.ClickXRelativeToWindow is { } x && step.ClickYRelativeToWindow is { } y)
        {
            return !string.IsNullOrWhiteSpace(step.WindowTitle)
                ? new StepDescription([new TextRun($"{verb} at ({x}, {y}) in "), Name(step.WindowTitle), new TextRun(".")])
                : Plain($"{verb} at ({x}, {y}) in {ApplicationName(step)}.");
        }

        return Plain(step.CursorX is { } screenX && step.CursorY is { } screenY
            ? $"{verb} at screen position ({screenX}, {screenY})."
            : $"{verb}.");
    }

    public static string ApplicationName(Step step) =>
        !string.IsNullOrWhiteSpace(step.ApplicationName) ? step.ApplicationName.Trim()
        : !string.IsNullOrWhiteSpace(step.ProcessName) ? step.ProcessName.Trim()
        : UnknownApplication;

    private static StepDescription? DescribeControl(Step step, string verb, bool plainLeftClick)
    {
        string? type = step.UIAutomationControlType;
        string? name = step.UIAutomationElementName;
        if (type is null)
        {
            return null;
        }

        if (type == "MenuItem")
        {
            string? label = step.UIAutomationMenuPath ?? name;
            return label is null ? null : Sentence(plainLeftClick ? "Select" : verb, label, "menu item", step);
        }

        if (name is null || IsBackground(type, name, step))
        {
            return null;
        }

        (string noun, bool selects) = type switch
        {
            "Button" or "SplitButton" => ("button", false),
            "TabItem" => ("tab", true),
            "Edit" => (step.IsSensitive ? "password box" : "text box", false),
            "Document" => ("document", false),
            "CheckBox" => ("check box", false),
            "RadioButton" => ("option", true),
            "ComboBox" => ("drop-down", false),
            "ListItem" => ("list item", true),
            "TreeItem" => ("tree item", true),
            "DataItem" => ("item", true),
            "Hyperlink" => ("link", false),
            "HeaderItem" => ("column header", false),
            "Slider" => ("slider", false),
            "Spinner" => ("spin box", false),
            "ScrollBar" => ("scroll bar", false),
            "Image" => ("image", false),
            "Text" => ("text", false),
            "TitleBar" => ("title bar", false),
            "MenuBar" or "Menu" => ("menu", false),
            "ToolBar" => ("toolbar", false),
            "StatusBar" => ("status bar", false),
            "List" => ("list", false),
            "Tree" => ("tree", false),
            "Table" or "DataGrid" => ("table", false),
            "Group" => ("group", false),
            "Pane" => ("pane", false),
            _ => (step.UIAutomationLocalizedControlType ?? "control", false),
        };

        return Sentence(selects && plainLeftClick ? "Select" : verb, name, noun, step);
    }

    // "Select the **Orders** tab in **Invoice Editor**."
    private static StepDescription Sentence(string verb, string name, string noun, Step step)
    {
        var runs = new List<TextRun> { new($"{verb} the "), Name(name), new($" {noun}") };

        if (ShellWindows.IsDesktop(step.WindowClassName))
        {
            runs.Add(new TextRun(" on the desktop"));
        }
        else if (ShellWindows.IsTaskbarOrTray(step.WindowClassName))
        {
            runs.Add(new TextRun(" on the taskbar"));
        }
        else if (!string.IsNullOrWhiteSpace(step.WindowTitle) && !string.Equals(step.WindowTitle.Trim(), name, StringComparison.Ordinal))
        {
            runs.Add(new TextRun(" in "));
            runs.Add(Name(step.WindowTitle));
        }

        runs.Add(new TextRun("."));
        return new StepDescription(runs);
    }

    /// <summary>
    /// The window itself, or a pane or group that only repeats the window title, says nothing about what
    /// was clicked. Coordinates are more useful then.
    /// </summary>
    private static bool IsBackground(string type, string name, Step step) =>
        type is "Window"
        || (type is "Pane" or "Custom" or "Group"
            && string.Equals(name, step.WindowTitle?.Trim(), StringComparison.Ordinal));

    private static StepDescription Plain(string text) => new([new TextRun(text)]);

    private static TextRun Name(string text)
    {
        string trimmed = text.Trim();
        return new TextRun(trimmed.Length > MaxNameLength ? trimmed[..(MaxNameLength - 1)] + "…" : trimmed, Emphasis: true);
    }

    // "Click", "Double-click", "Right-click", "Double right-click", "Click (5 times)"...
    private static string Verb(Step step)
    {
        string click = step.MouseButton switch
        {
            MouseButton.Right => "right-click",
            MouseButton.Middle => "middle-click",
            _ => "click",
        };

        string verb = step.ClickCount switch
        {
            null or <= 1 => click,
            2 => click == "click" ? "double-click" : $"double {click}",
            3 => click == "click" ? "triple-click" : $"triple {click}",
            int n => $"{click} ({n} times)",
        };

        return char.ToUpperInvariant(verb[0]) + verb[1..];
    }
}
