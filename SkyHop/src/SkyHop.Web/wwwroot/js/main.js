// Frame loop: each animation frame asks .NET to advance the game, then draws the returned snapshot
// and plays sounds for the events it reports.
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer } from './renderer.js';

export function start(frame, dotnet, config) {
    const canvas = frame.querySelector('canvas');
    const renderer = createRenderer(canvas, config);
    const audio = createAudio();
    const fps = { frames: 0, elapsed: 0, value: 0 };

    const input = createInput(
        frame,
        action => {
            audio.unlock();
            dotnet.invokeMethod('OnAction', action);
        },
        () => dotnet.invokeMethod('OnFocusLost'),
    );

    let last = performance.now();
    let rafId = requestAnimationFrame(loop);

    function loop(now) {
        // Long gaps (tab hidden, breakpoint) are clamped here and again inside the game.
        const dt = Math.min((now - last) / 1000, 0.25);
        last = now;

        fps.frames++;
        fps.elapsed += dt;
        if (fps.elapsed >= 0.5) {
            fps.value = fps.frames / fps.elapsed;
            fps.frames = 0;
            fps.elapsed = 0;
        }

        const snapshot = dotnet.invokeMethod('Tick', dt);
        for (const event of snapshot.events) {
            audio.play(event, snapshot.muted);
            renderer.onEvent(event, snapshot);
        }
        renderer.draw(snapshot, dt, fps.value);

        // Exposed only in debug mode, for inspecting live state from the console or automated checks.
        if (snapshot.debug) window.skyhopDebug = snapshot;
        else if (window.skyhopDebug) delete window.skyhopDebug;

        rafId = requestAnimationFrame(loop);
    }

    return {
        dispose() {
            cancelAnimationFrame(rafId);
            input.dispose();
            audio.dispose();
            renderer.dispose();
        },
    };
}
