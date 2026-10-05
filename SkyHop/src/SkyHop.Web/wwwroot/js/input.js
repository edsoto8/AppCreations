// Input layer: turns keyboard, mouse and touch into named actions the game understands.
// Game logic never sees raw devices, only "Flap", "TogglePause", "ToggleMute" and "ToggleDebug".

const KEY_ACTIONS = {
    Space: 'Flap',
    ArrowUp: 'Flap',
    KeyP: 'TogglePause',
    Escape: 'TogglePause',
    KeyM: 'ToggleMute',
    Backquote: 'ToggleDebug',
};

export function createInput(frame, onAction, onFocusLost) {
    function onKeyDown(e) {
        const action = KEY_ACTIONS[e.code];
        if (!action || e.ctrlKey || e.metaKey || e.altKey) return;
        // Stop the page scrolling and stop Space from "clicking" a focused button.
        e.preventDefault();
        // Holding a key down must not auto-repeat flaps: one press, one flap.
        if (e.repeat) return;
        onAction(action);
    }

    function onKeyUp(e) {
        if (KEY_ACTIONS[e.code]) e.preventDefault();
    }

    // Pointer events cover mouse, pen and touch with one event per press, so a tap never counts twice.
    function onPointerDown(e) {
        if (e.target.closest('button, a')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        onAction('Flap');
    }

    // Buttons should not keep keyboard focus, or a later Space press could activate them again.
    function onClick(e) {
        const button = e.target.closest('button');
        if (button) button.blur();
    }

    function onVisibilityChange() {
        if (document.hidden) onFocusLost();
    }

    const preventDefault = e => e.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onFocusLost);
    window.addEventListener('pagehide', onFocusLost);
    document.addEventListener('visibilitychange', onVisibilityChange);
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('click', onClick);
    frame.addEventListener('contextmenu', preventDefault);

    return {
        dispose() {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
            window.removeEventListener('blur', onFocusLost);
            window.removeEventListener('pagehide', onFocusLost);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            frame.removeEventListener('pointerdown', onPointerDown);
            frame.removeEventListener('click', onClick);
            frame.removeEventListener('contextmenu', preventDefault);
        },
    };
}
