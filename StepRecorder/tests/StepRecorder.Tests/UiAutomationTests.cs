using StepRecorder.Core.Automation;
using StepRecorder.Core.Capture;
using StepRecorder.Core.Input;
using StepRecorder.Core.Recording;
using StepRecorder.Core.Reporting;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed class UiAutomationTests : IDisposable
{
    private static readonly WindowInfo InvoiceEditor = new(
        Handle: 0x1001,
        ProcessId: 100,
        ProcessName: "invoices",
        ApplicationName: "Invoices",
        Title: "Invoice Editor",
        ClassName: "WindowsForms10.Window",
        Bounds: new ScreenRect(0, 0, 800, 600),
        Dpi: 96);

    private static readonly UiElementInfo SaveButton = new("Save", "Button", "button", "btnSave", new ScreenRect(10, 10, 80, 24), IsPassword: false);

    private readonly TempDirectory temp = new();
    private readonly ManualTimeProvider clock = new(TestEnvironment.Start);
    private readonly FakeSource source = new();
    private readonly FakeInspector windows = new();
    private readonly FakeElements elements = new();
    private readonly Recorder recorder;
    private readonly ClickRecorder clicks;

    public UiAutomationTests()
    {
        recorder = new Recorder(new FileSessionStore(), TestEnvironment.Environment, clock);
        clicks = new ClickRecorder(
            recorder,
            source,
            windows,
            new NoCapture(),
            ownProcessId: 4242,
            clock,
            elementInspector: elements,
            elementLookupTimeout: TimeSpan.FromMilliseconds(300));
    }

    public void Dispose()
    {
        elements.Release();
        clicks.Dispose();
        temp.Dispose();
    }

    private Session Start(RecordingSettings? settings = null) =>
        recorder.Start(temp.Path, "Test", settings ?? new RecordingSettings());

    private static MouseClick ClickAt(int x, int y, int secondsIn = 0) =>
        new(MouseButton.Left, x, y, TestEnvironment.Start.AddSeconds(secondsIn));

    // ---- Pipeline ----

    [Fact]
    public async Task Element_IsStoredOnStep()
    {
        Session session = Start();
        windows.Window = InvoiceEditor;
        elements.Element = SaveButton;

        source.Click(ClickAt(40, 20));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Equal("Save", step.UIAutomationElementName);
        Assert.Equal("Button", step.UIAutomationControlType);
        Assert.Equal("button", step.UIAutomationLocalizedControlType);
        Assert.Equal("btnSave", step.UIAutomationAutomationId);
        Assert.Equal(new ScreenRect(10, 10, 80, 24), step.UIAutomationBounds);
        Assert.False(step.IsSensitive);
        Assert.Equal((40, 20), elements.LastPoint);
        Assert.Equal("Button", new FileSessionStore().Load(session.Directory).Steps[0].UIAutomationControlType);
    }

    [Fact]
    public async Task PasswordField_MarksStepSensitive()
    {
        Session session = Start();
        windows.Window = InvoiceEditor;
        elements.Element = new UiElementInfo("Password", "Edit", "edit", "txtPassword", null, IsPassword: true);

        source.Click(ClickAt(40, 20));
        await clicks.FlushAsync();

        Assert.True(Assert.Single(session.Steps).IsSensitive);
    }

    [Fact]
    public async Task MenuPath_IsJoined()
    {
        Session session = Start();
        windows.Window = InvoiceEditor;
        elements.Element = new UiElementInfo("Export", "MenuItem", "menu item", null, null, false, ["File", " ", "Export"]);

        source.Click(ClickAt(40, 20));
        await clicks.FlushAsync();

        Assert.Equal("File > Export", Assert.Single(session.Steps).UIAutomationMenuPath);
    }

    [Fact]
    public async Task LookupFailure_StillRecordsStepWithoutControl()
    {
        Session session = Start();
        windows.Window = InvoiceEditor;
        elements.Throw = true;

        source.Click(ClickAt(40, 20));
        await clicks.FlushAsync();

        Step step = Assert.Single(session.Steps);
        Assert.Null(step.UIAutomationControlType);
        Assert.Equal("Invoice Editor", step.WindowTitle);
    }

    [Fact]
    public async Task SlowLookup_TimesOut_AndHungLookupIsNotRepeated()
    {
        Session session = Start();
        windows.Window = InvoiceEditor;
        elements.Element = SaveButton;
        elements.Block();

        source.Click(ClickAt(40, 20, secondsIn: 0));
        source.Click(ClickAt(300, 300, secondsIn: 5));
        var timer = System.Diagnostics.Stopwatch.StartNew();
        await clicks.FlushAsync();
        timer.Stop();

        Assert.Equal(2, session.StepCount);
        Assert.All(session.Steps, s => Assert.Null(s.UIAutomationControlType));
        Assert.Equal(1, elements.Calls);                       // the second click didn't start another hung lookup
        Assert.True(timer.Elapsed < TimeSpan.FromSeconds(3), $"took {timer.Elapsed}");

        elements.Release();
        await Task.Delay(50);
        source.Click(ClickAt(40, 20, secondsIn: 10));
        await clicks.FlushAsync();
        Assert.Equal("Save", session.Steps[^1].UIAutomationElementName); // recovers once the app responds
    }

    [Fact]
    public async Task IdentifyControlsOff_SkipsLookup()
    {
        Session session = Start(new RecordingSettings { IdentifyControls = false });
        windows.Window = InvoiceEditor;
        elements.Element = SaveButton;

        source.Click(ClickAt(40, 20));
        await clicks.FlushAsync();

        Assert.Equal(0, elements.Calls);
        Assert.Null(Assert.Single(session.Steps).UIAutomationControlType);
    }

    [Fact]
    public async Task OwnWindows_AreNeverInspected()
    {
        Start();
        windows.Window = InvoiceEditor with { ProcessId = 4242 };
        elements.Element = SaveButton;

        source.Click(ClickAt(40, 20));
        await clicks.FlushAsync();

        Assert.Equal(0, elements.Calls);
    }

    [Fact]
    public async Task MergedDoubleClick_DoesNotLookUpAgain()
    {
        Session session = Start();
        windows.Window = InvoiceEditor;
        elements.Element = SaveButton;

        source.Click(new MouseClick(MouseButton.Left, 40, 20, TestEnvironment.Start));
        source.Click(new MouseClick(MouseButton.Left, 40, 20, TestEnvironment.Start.AddMilliseconds(150)));
        await clicks.FlushAsync();

        Assert.Equal(1, elements.Calls);
        Assert.Equal(2, Assert.Single(session.Steps).ClickCount);
    }

    // ---- Descriptions ----

    private static Step StepWith(string? type, string? name, string title = "Invoice Editor", MouseButton button = MouseButton.Left, int? clicks = null) => new()
    {
        MouseButton = button,
        ClickCount = clicks,
        WindowTitle = title,
        ClickXRelativeToWindow = 40,
        ClickYRelativeToWindow = 20,
        UIAutomationControlType = type,
        UIAutomationElementName = name,
    };

    [Theory]
    [InlineData("Button", "Save", "Click the \"Save\" button in \"Invoice Editor\".")]
    [InlineData("SplitButton", "New", "Click the \"New\" button in \"Invoice Editor\".")]
    [InlineData("TabItem", "Orders", "Select the \"Orders\" tab in \"Invoice Editor\".")]
    [InlineData("Edit", "Customer Name", "Click the \"Customer Name\" text box in \"Invoice Editor\".")]
    [InlineData("CheckBox", "Paid", "Click the \"Paid\" check box in \"Invoice Editor\".")]
    [InlineData("RadioButton", "Monthly", "Select the \"Monthly\" option in \"Invoice Editor\".")]
    [InlineData("ComboBox", "Currency", "Click the \"Currency\" drop-down in \"Invoice Editor\".")]
    [InlineData("ListItem", "INV-0042", "Select the \"INV-0042\" list item in \"Invoice Editor\".")]
    [InlineData("TreeItem", "Customers", "Select the \"Customers\" tree item in \"Invoice Editor\".")]
    [InlineData("Hyperlink", "Help", "Click the \"Help\" link in \"Invoice Editor\".")]
    [InlineData("HeaderItem", "Amount", "Click the \"Amount\" column header in \"Invoice Editor\".")]
    [InlineData("MenuItem", "Export", "Select the \"Export\" menu item in \"Invoice Editor\".")]
    public void Describe_DistinguishesControlTypes(string type, string name, string expected)
    {
        Assert.Equal(expected, StepDescriber.Describe(StepWith(type, name)));
    }

    [Fact]
    public void Describe_MenuItem_UsesFullMenuPath()
    {
        Step step = StepWith("MenuItem", "Export");
        step.UIAutomationMenuPath = "File > Export";

        Assert.Equal("Select the \"File > Export\" menu item in \"Invoice Editor\".", StepDescriber.Describe(step));
    }

    [Fact]
    public void Describe_PasswordBox()
    {
        Step step = StepWith("Edit", "Password");
        step.IsSensitive = true;

        Assert.Equal("Click the \"Password\" password box in \"Invoice Editor\".", StepDescriber.Describe(step));
    }

    [Theory]
    [InlineData(MouseButton.Right, null, "Right-click the \"INV-0042\" list item in \"Invoice Editor\".")]
    [InlineData(MouseButton.Left, 2, "Double-click the \"INV-0042\" list item in \"Invoice Editor\".")]
    public void Describe_SelectVerbOnlyForPlainLeftClick(MouseButton button, int? count, string expected)
    {
        Assert.Equal(expected, StepDescriber.Describe(StepWith("ListItem", "INV-0042", button: button, clicks: count)));
    }

    [Fact]
    public void Describe_UnknownType_UsesLocalizedName()
    {
        Step step = StepWith("Calendar", "October");
        step.UIAutomationLocalizedControlType = "calendar";

        Assert.Equal("Click the \"October\" calendar in \"Invoice Editor\".", StepDescriber.Describe(step));
    }

    [Theory]
    [InlineData("Window", "Invoice Editor")]
    [InlineData("Pane", "Invoice Editor")]
    [InlineData("Button", null)]
    [InlineData(null, "Save")]
    public void Describe_UninformativeElement_FallsBackToCoordinates(string? type, string? name)
    {
        Assert.Equal("Click at (40, 20) in \"Invoice Editor\".", StepDescriber.Describe(StepWith(type, name)));
    }

    [Fact]
    public void Describe_NameEqualToWindowTitle_OmitsRepeatedTitle()
    {
        Assert.Equal("Click the \"Notepad\" button.", StepDescriber.Describe(StepWith("Button", "Notepad", title: "Notepad")));
    }

    [Fact]
    public void Describe_DesktopAndTaskbarControls()
    {
        Step desktop = StepWith("ListItem", "Recycle Bin", title: "Program Manager", clicks: 2);
        desktop.WindowClassName = "Progman";
        Step taskbar = StepWith("Button", "Microsoft Edge", title: "");
        taskbar.WindowClassName = "Shell_TrayWnd";

        Assert.Equal("Double-click the \"Recycle Bin\" list item on the desktop.", StepDescriber.Describe(desktop));
        Assert.Equal("Click the \"Microsoft Edge\" button on the taskbar.", StepDescriber.Describe(taskbar));
    }

    [Fact]
    public void Describe_LongNamesAreShortened()
    {
        string description = StepDescriber.Describe(StepWith("ListItem", new string('x', 200)));

        Assert.Contains(new string('x', StepDescriber.MaxNameLength - 1) + "…\"", description);
        Assert.DoesNotContain(new string('x', StepDescriber.MaxNameLength + 1), description);
    }

    [Fact]
    public void Describe_StoredDescriptionStillWins()
    {
        Step step = StepWith("Button", "Save");
        step.GeneratedDescription = "Save the invoice.";

        Assert.Equal("Save the invoice.", StepDescriber.Describe(step));
    }

    // ---- Rendering ----

    [Fact]
    public void Reports_RenderControlNamesInBoldAndEscapeThem()
    {
        Step step = StepWith("Button", "<Save & *Close*>");
        var session = new Session { Name = "UIA", StartedAt = TestEnvironment.Start };
        session.Steps.Add(step);
        ReportModel model = ReportBuilder.Build(session);

        string html = HtmlReportExporter.Render(model);
        string md = MarkdownReportExporter.Render(model);

        Assert.Contains("Click the <strong>&lt;Save &amp; *Close*&gt;</strong> button in <strong>Invoice Editor</strong>.", html);
        Assert.Contains(@"Click the **\<Save & \*Close\*\>** button in **Invoice Editor**.", md);
    }

    [Fact]
    public void Reports_FlagPasswordSteps()
    {
        Step step = StepWith("Edit", "Password");
        step.IsSensitive = true;
        var session = new Session { Name = "UIA", StartedAt = TestEnvironment.Start };
        session.Steps.Add(step);
        ReportModel model = ReportBuilder.Build(session);

        Assert.Contains("<span class=\"badge\">Password field</span>", HtmlReportExporter.Render(model));
        Assert.Contains("*(password field)*", MarkdownReportExporter.Render(model));
    }

    [Fact]
    public void Settings_IdentifyControlsDefaultsOnAndRoundTrips()
    {
        string path = Path.Combine(temp.Path, "settings.json");
        var store = new JsonSettingsStore(path);
        Assert.True(store.Load().Recording.IdentifyControls);

        store.Save(new RecorderSettings { Recording = new RecordingSettings { IdentifyControls = false } });

        Assert.False(store.Load().Recording.IdentifyControls);
    }

    // ---- Fakes ----

    private sealed class FakeSource : IMouseClickSource
    {
        private Action<MouseClick>? onClick;

        public void Start(Action<MouseClick> onClick) => this.onClick = onClick;

        public void Stop() => onClick = null;

        public void Dispose() => Stop();

        public void Click(MouseClick click) => onClick?.Invoke(click);
    }

    private sealed class FakeInspector : IWindowInspector
    {
        public WindowInfo? Window { get; set; }

        public WindowInfo? GetTopLevelWindowAt(int x, int y) => Window;
    }

    private sealed class NoCapture : IWindowCapture
    {
        public CaptureResult Capture(WindowInfo window, ScreenshotSettings settings) =>
            CaptureResult.Failed("Not captured in these tests.");
    }

    private sealed class FakeElements : IUiElementInspector
    {
        private readonly ManualResetEventSlim gate = new(initialState: true);
        private int calls;

        public UiElementInfo? Element { get; set; }

        public bool Throw { get; set; }

        public int Calls => Volatile.Read(ref calls);

        public (int X, int Y) LastPoint { get; private set; }

        public void Block() => gate.Reset();

        public void Release() => gate.Set();

        public UiElementInfo? GetElementAt(int x, int y)
        {
            Interlocked.Increment(ref calls);
            LastPoint = (x, y);
            gate.Wait(TimeSpan.FromSeconds(10));
            return Throw ? throw new InvalidOperationException("Simulated UIA failure.") : Element;
        }
    }
}
