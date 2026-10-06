using StepRecorder.Core.Recording;
using StepRecorder.Core.Sessions;
using StepRecorder.Core.Settings;
using StepRecorder.Core.Storage;

namespace StepRecorder.Tests;

public sealed class RecorderTests : IDisposable
{
    private readonly TempDirectory temp = new();
    private readonly ManualTimeProvider clock = new(TestEnvironment.Start);
    private readonly FlakySessionStore store = new(new FileSessionStore());
    private readonly Recorder recorder;

    public RecorderTests()
    {
        recorder = new Recorder(store, TestEnvironment.Environment, clock);
    }

    public void Dispose() => temp.Dispose();

    private Session Start(string? name = "Test") => recorder.Start(temp.Path, name, new RecordingSettings());

    [Fact]
    public void NewRecorder_IsIdle()
    {
        Assert.Equal(RecordingState.Idle, recorder.State);
        Assert.Null(recorder.CurrentSession);
    }

    [Fact]
    public void Start_CreatesSessionFolderAndPersistsMetadata()
    {
        Session session = Start("My Recording");

        Assert.Equal(RecordingState.Recording, recorder.State);
        Assert.Same(session, recorder.CurrentSession);
        Assert.Equal(Path.Combine(temp.Path, "2026-10-05_175700_My-Recording"), session.Directory);

        Session saved = new FileSessionStore().Load(session.Directory);
        Assert.Equal(session.SessionId, saved.SessionId);
        Assert.Equal("My Recording", saved.Name);
        Assert.Equal(SessionStatus.Recording, saved.Status);
        Assert.Equal(TestEnvironment.Start, saved.StartedAt);
        Assert.Equal("1.2.3", saved.ApplicationVersion);
        Assert.Equal("Windows 11 (test)", saved.OperatingSystem);
        Assert.Null(saved.EndedAt);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Start_WithoutName_UsesDefaultName(string? name)
    {
        Session session = Start(name);

        Assert.Equal(StorageSettings.DefaultName, session.Name);
    }

    [Fact]
    public void Start_SnapshotsRecordingSettings()
    {
        var settings = new RecordingSettings { CaptureRightClick = false };

        Session session = recorder.Start(temp.Path, "Test", settings);

        Assert.False(new FileSessionStore().Load(session.Directory).RecordingSettingsSnapshot.CaptureRightClick);
    }

    [Fact]
    public void Start_WhileRecordingOrPaused_IsRejected()
    {
        Start();
        Assert.Throws<InvalidOperationException>(() => Start());

        recorder.Pause();
        Assert.Throws<InvalidOperationException>(() => Start());

        Assert.Single(Directory.GetDirectories(temp.Path));
    }

    [Fact]
    public void Start_WhenSaveFails_StaysIdle()
    {
        store.FailSaves = true;

        Assert.Throws<IOException>(() => Start());

        Assert.Equal(RecordingState.Idle, recorder.State);
        Assert.Null(recorder.CurrentSession);
    }

    [Fact]
    public void PauseAndResume_ChangeStateAndPersistStatus()
    {
        Session session = Start();

        recorder.Pause();
        Assert.Equal(RecordingState.Paused, recorder.State);
        Assert.Equal(SessionStatus.Paused, new FileSessionStore().Load(session.Directory).Status);

        recorder.Resume();
        Assert.Equal(RecordingState.Recording, recorder.State);
        Assert.Equal(SessionStatus.Recording, new FileSessionStore().Load(session.Directory).Status);
    }

    [Fact]
    public void InvalidTransitions_Throw()
    {
        Assert.Throws<InvalidOperationException>(recorder.Pause);
        Assert.Throws<InvalidOperationException>(recorder.Resume);
        Assert.Throws<InvalidOperationException>(() => recorder.Stop());

        Start();
        Assert.Throws<InvalidOperationException>(recorder.Resume);

        recorder.Pause();
        Assert.Throws<InvalidOperationException>(recorder.Pause);
    }

    [Fact]
    public void Stop_FinalizesSessionAndExcludesPausesFromActiveDuration()
    {
        Session session = Start();
        clock.Advance(TimeSpan.FromSeconds(10));
        recorder.Pause();
        clock.Advance(TimeSpan.FromSeconds(30));
        recorder.Resume();
        clock.Advance(TimeSpan.FromSeconds(5));

        recorder.Stop();

        Session saved = new FileSessionStore().Load(session.Directory);
        Assert.Equal(SessionStatus.Completed, saved.Status);
        Assert.Equal(TestEnvironment.Start.AddSeconds(45), saved.EndedAt);
        Assert.Equal(TimeSpan.FromSeconds(45), saved.Duration);
        Assert.Equal(TimeSpan.FromSeconds(15), saved.ActiveDuration);
        Assert.Equal(RecordingState.Idle, recorder.State);
        Assert.Null(recorder.CurrentSession);
        Assert.Same(session, recorder.LastSession);
    }

    [Fact]
    public void Stop_WhilePaused_CountsOpenPause()
    {
        Start();
        clock.Advance(TimeSpan.FromSeconds(10));
        recorder.Pause();
        clock.Advance(TimeSpan.FromSeconds(20));

        Session session = recorder.Stop();

        Assert.Equal(TimeSpan.FromSeconds(30), session.Duration);
        Assert.Equal(TimeSpan.FromSeconds(10), session.ActiveDuration);
    }

    [Fact]
    public void Stop_WhenFinalSaveFails_StillReturnsToIdle()
    {
        Start();
        store.FailSaves = true;

        Assert.Throws<IOException>(() => recorder.Stop());

        Assert.Equal(RecordingState.Idle, recorder.State);
    }

    [Fact]
    public void Pause_WhenSaveFails_KeepsRecordingAlive()
    {
        Start();
        store.FailSaves = true;

        recorder.Pause();
        recorder.Resume();

        Assert.Equal(RecordingState.Recording, recorder.State);
    }

    [Fact]
    public void StateChanged_ReportsEveryTransition()
    {
        var transitions = new List<(RecordingState, RecordingState)>();
        recorder.StateChanged += (_, e) => transitions.Add((e.Previous, e.Current));

        Start();
        recorder.Pause();
        recorder.Resume();
        recorder.Stop();

        Assert.Equal(
            [
                (RecordingState.Idle, RecordingState.Recording),
                (RecordingState.Recording, RecordingState.Paused),
                (RecordingState.Paused, RecordingState.Recording),
                (RecordingState.Recording, RecordingState.Idle),
            ],
            transitions);
    }

    [Fact]
    public void BackToBackSessions_GetSeparateFolders()
    {
        Session first = Start();
        recorder.Stop();
        Session second = Start();
        recorder.Stop();

        Assert.NotEqual(first.SessionId, second.SessionId);
        Assert.NotEqual(first.Directory, second.Directory);
        Assert.Equal(2, Directory.GetDirectories(temp.Path).Length);
    }
}
