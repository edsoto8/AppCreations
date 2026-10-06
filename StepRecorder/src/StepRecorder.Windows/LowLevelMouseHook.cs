using System.ComponentModel;
using System.Runtime.InteropServices;
using StepRecorder.Core.Input;
using StepRecorder.Core.Sessions;
using static StepRecorder.Windows.NativeMethods;

namespace StepRecorder.Windows;

/// <summary>
/// Global mouse-button observer built on <c>WH_MOUSE_LL</c> (docs/decisions/0002). The hook lives on its
/// own thread with its own message loop, so a busy UI thread can never make Windows drop the hook for
/// being slow. The callback only reads the event and hands it on. It never blocks, swallows or
/// changes input.
/// </summary>
public sealed class LowLevelMouseHook : IMouseClickSource
{
    private static readonly TimeSpan StopTimeout = TimeSpan.FromSeconds(2);

    private readonly object gate = new();

    // Held in a field so the GC cannot collect the delegate while native code still calls it.
    private readonly LowLevelMouseProc callback;

    private Thread? thread;
    private uint threadId;
    private volatile Action<MouseClick>? onClick;

    public LowLevelMouseHook()
    {
        callback = HookCallback;
    }

    public void Start(Action<MouseClick> onClick)
    {
        lock (gate)
        {
            if (thread is not null)
            {
                return;
            }

            this.onClick = onClick;
            using var ready = new ManualResetEventSlim();
            int startError = 0;

            var hookThread = new Thread(() =>
            {
                // Make sure the thread has a message queue before anyone posts WM_QUIT to it.
                PeekMessage(out _, IntPtr.Zero, 0, 0, PM_NOREMOVE);
                threadId = GetCurrentThreadId();

                IntPtr hook = SetWindowsHookEx(WH_MOUSE_LL, callback, GetModuleHandle(null), 0);
                if (hook == IntPtr.Zero)
                {
                    startError = Marshal.GetLastWin32Error();
                    ready.Set();
                    return;
                }

                ready.Set();
                try
                {
                    // WH_MOUSE_LL callbacks are delivered while this thread pumps messages.
                    while (GetMessage(out MSG message, IntPtr.Zero, 0, 0) > 0)
                    {
                    }
                }
                finally
                {
                    UnhookWindowsHookEx(hook);
                }
            })
            {
                IsBackground = true,
                Name = "StepRecorder mouse hook",
                Priority = ThreadPriority.AboveNormal,
            };

            hookThread.Start();
            ready.Wait();

            if (startError != 0)
            {
                hookThread.Join();
                this.onClick = null;
                throw new InvalidOperationException(
                    "Could not install the global mouse hook.",
                    new Win32Exception(startError));
            }

            thread = hookThread;
        }
    }

    public void Stop()
    {
        lock (gate)
        {
            if (thread is null)
            {
                return;
            }

            onClick = null;
            PostThreadMessage(threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
            thread.Join(StopTimeout);
            thread = null;
        }
    }

    public void Dispose() => Stop();

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            MouseButton? button = (int)wParam switch
            {
                WM_LBUTTONDOWN => MouseButton.Left,
                WM_RBUTTONDOWN => MouseButton.Right,
                WM_MBUTTONDOWN => MouseButton.Middle,
                _ => null,
            };

            if (button is { } pressed && onClick is { } handler)
            {
                try
                {
                    var data = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
                    handler(new MouseClick(pressed, data.Point.X, data.Point.Y, DateTimeOffset.Now));
                }
                catch (Exception)
                {
                    // An exception must never unwind into user32; that would break the user's input.
                }
            }
        }

        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }
}
