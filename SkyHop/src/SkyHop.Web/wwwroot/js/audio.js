// AudioManager: tiny synthesized sound effects (no audio files), played from game events.
// Browsers only allow audio after a user gesture, so unlock() is called from the input handler.

export function createAudio() {
    let ctx = null;
    let master = null;
    let noise = null;

    function unlock() {
        if (!ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            ctx = new AudioContext();
            master = ctx.createGain();
            master.gain.value = 0.35;
            master.connect(ctx.destination);
            noise = createNoiseBuffer(ctx);
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    function tone({ type = 'triangle', from, to = from, duration, volume = 0.5, delay = 0 }) {
        const t = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(to, t + duration);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + duration + 0.02);
    }

    function thud(volume = 0.7) {
        const t = ctx.currentTime;
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        src.buffer = noise;
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, t);
        filter.frequency.exponentialRampToValueAtTime(200, t + 0.18);
        gain.gain.setValueAtTime(volume, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        src.connect(filter).connect(gain).connect(master);
        src.start(t);
        src.stop(t + 0.22);
        tone({ type: 'sine', from: 160, to: 50, duration: 0.22, volume: 0.8 });
    }

    const sounds = {
        Flapped: () => tone({ from: 420, to: 760, duration: 0.09, volume: 0.35 }),
        Scored: () => {
            tone({ type: 'square', from: 880, duration: 0.06, volume: 0.18 });
            tone({ type: 'square', from: 1320, duration: 0.11, volume: 0.18, delay: 0.06 });
        },
        HitObstacle: () => thud(),
        HitGround: () => thud(0.55),
        HitBoundary: () => thud(),
        GameOver: () => {
            tone({ from: 520, to: 390, duration: 0.16, volume: 0.35, delay: 0.05 });
            tone({ from: 390, to: 200, duration: 0.32, volume: 0.35, delay: 0.21 });
        },
        NewBest: () => {
            [660, 830, 990, 1320].forEach((f, i) =>
                tone({ type: 'square', from: f, duration: 0.1, volume: 0.14, delay: 0.55 + i * 0.08 }));
        },
        Paused: () => tone({ type: 'sine', from: 600, to: 400, duration: 0.08, volume: 0.25 }),
        Resumed: () => tone({ type: 'sine', from: 400, to: 600, duration: 0.08, volume: 0.25 }),
    };

    return {
        unlock,
        play(event, muted) {
            if (muted || !ctx || ctx.state === 'closed') return;
            const sound = sounds[event];
            if (sound) sound();
        },
        dispose() {
            if (ctx) ctx.close();
            ctx = null;
        },
    };
}

function createNoiseBuffer(ctx) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.25), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
}
