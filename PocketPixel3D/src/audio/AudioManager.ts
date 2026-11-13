import { midiToFrequency, parseTrack } from '../games/common/MusicNotation';
import type { MusicTrack, ParsedNote, ParsedTrack, SfxSpec, SoundOutput, Waveform } from '../games/GameInterface';

/** Physical (non-speaker) sounds: these play at a fixed level whatever the volume wheel says. */
export type MechanicalSound = 'press' | 'release' | 'switch' | 'wheel' | 'cartIn' | 'cartOut' | 'cover' | 'deny';

const LOOKAHEAD_SECONDS = 0.15;
const SCHEDULER_INTERVAL_MS = 25;

interface MusicState {
  track: MusicTrack;
  parsed: ParsedTrack;
  /** notesByStep[channel][step] = notes starting on that step. */
  notesByStep: (ParsedNote[] | undefined)[][];
  bus: GainNode;
  step: number;
  nextTime: number;
}

/**
 * Web Audio engine. Two buses feed the output:
 * - the speaker bus (game sfx, music, boot chime), scaled by the console's volume wheel;
 * - the mechanical bus (button clicks, switch, cartridge), at a fixed level.
 *
 * The AudioContext is only created inside a user gesture (see {@link unlock}) to respect autoplay
 * policies; before that every call is a silent no-op.
 */
export class AudioManager implements SoundOutput {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private speaker: GainNode | null = null;
  private mechanical: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly waves = new Map<Waveform, PeriodicWave>();
  private music: MusicState | null = null;
  private pendingTrack: MusicTrack | null = null;
  private timer: number | null = null;
  private volume = 0.6;
  private muted = false;

  get unlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get currentTrackId(): string | null {
    return this.music?.track.id ?? null;
  }

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    if (this.pendingTrack) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.playMusic(t);
    }
  }

  /** Volume wheel position 0..1 (perceptual curve applied here). */
  setVolume(value: number): void {
    this.volume = value;
    this.applySpeakerGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  sfx(spec: SfxSpec): void {
    const ctx = this.ctx;
    if (!ctx || !this.speaker) return;
    this.playSpec(ctx, spec, this.speaker, ctx.currentTime + 0.005);
  }

  playMusic(track: MusicTrack): void {
    if (this.music?.track === track) return;
    const ctx = this.ctx;
    if (!ctx || !this.speaker) {
      this.pendingTrack = track;
      return;
    }
    this.stopMusic();
    const parsed = parseTrack(track);
    const bus = ctx.createGain();
    bus.gain.value = 0.55;
    bus.connect(this.speaker);
    const notesByStep = parsed.channels.map((ch) => {
      const arr: (ParsedNote[] | undefined)[] = new Array(parsed.totalSteps);
      for (const n of ch.notes) (arr[n.step] ??= []).push(n);
      return arr;
    });
    this.music = { track, parsed, notesByStep, bus, step: 0, nextTime: ctx.currentTime + 0.06 };
    this.timer = window.setInterval(() => this.schedule(), SCHEDULER_INTERVAL_MS);
    this.schedule();
  }

  stopMusic(): void {
    this.pendingTrack = null;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    const m = this.music;
    this.music = null;
    if (m && this.ctx) {
      const t = this.ctx.currentTime;
      m.bus.gain.cancelScheduledValues(t);
      m.bus.gain.setValueAtTime(m.bus.gain.value, t);
      m.bus.gain.linearRampToValueAtTime(0, t + 0.04);
      window.setTimeout(() => m.bus.disconnect(), 120);
    }
  }

  playMechanical(kind: MechanicalSound): void {
    const ctx = this.ctx;
    const out = this.mechanical;
    if (!ctx || !out) return;
    const t = ctx.currentTime + 0.002;
    switch (kind) {
      case 'press':
        this.noiseBurst(ctx, out, t, 0.025, 3200, 'bandpass', 0.55);
        this.tone(ctx, out, t, 0.02, 1400, 600, 0.08);
        break;
      case 'release':
        this.noiseBurst(ctx, out, t, 0.018, 4200, 'bandpass', 0.3);
        break;
      case 'switch':
        this.noiseBurst(ctx, out, t, 0.02, 2600, 'bandpass', 0.6);
        this.noiseBurst(ctx, out, t + 0.06, 0.03, 1800, 'bandpass', 0.7);
        this.tone(ctx, out, t + 0.06, 0.04, 220, 120, 0.25);
        break;
      case 'wheel':
        this.noiseBurst(ctx, out, t, 0.012, 5200, 'highpass', 0.25);
        break;
      case 'cartIn':
        this.noiseSweep(ctx, out, t, 0.32, 900, 2600, 0.22);
        this.noiseBurst(ctx, out, t + 0.34, 0.04, 1200, 'bandpass', 0.9);
        this.tone(ctx, out, t + 0.34, 0.07, 160, 70, 0.45);
        break;
      case 'cartOut':
        this.noiseBurst(ctx, out, t, 0.03, 1500, 'bandpass', 0.7);
        this.noiseSweep(ctx, out, t + 0.04, 0.3, 2600, 900, 0.2);
        break;
      case 'cover':
        this.noiseBurst(ctx, out, t, 0.03, 2200, 'bandpass', 0.6);
        this.tone(ctx, out, t, 0.05, 300, 140, 0.2);
        break;
      case 'deny':
        this.tone(ctx, out, t, 0.06, 160, 150, 0.35);
        this.tone(ctx, out, t + 0.09, 0.06, 160, 150, 0.35);
        break;
    }
  }

  dispose(): void {
    this.stopMusic();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  // ---------------------------------------------------------------------------------------------

  private build(ctx: AudioContext): void {
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.speaker = ctx.createGain();
    // A tiny speaker: roll off lows and extreme highs.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 180;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000;
    this.speaker.connect(hp).connect(lp).connect(this.master);
    this.applySpeakerGain();

    this.mechanical = ctx.createGain();
    this.mechanical.gain.value = 0.5;
    this.mechanical.connect(this.master);

    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 22222;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff - 1) * 0.9;
    }
    for (const [name, duty] of [
      ['pulse12', 0.125],
      ['pulse25', 0.25],
      ['pulse50', 0.5],
    ] as const) {
      this.waves.set(name, pulseWave(ctx, duty));
    }
  }

  private applySpeakerGain(): void {
    if (!this.speaker || !this.ctx) return;
    const v = this.volume * this.volume * 0.8;
    this.speaker.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  private schedule(): void {
    const ctx = this.ctx;
    const m = this.music;
    if (!ctx || !m) return;
    const { parsed } = m;
    // If the tab was throttled, skip ahead instead of firing a burst of stale notes.
    if (m.nextTime < ctx.currentTime - 0.25) m.nextTime = ctx.currentTime + 0.02;
    while (m.nextTime < ctx.currentTime + LOOKAHEAD_SECONDS) {
      for (let c = 0; c < parsed.channels.length; c++) {
        const ch = parsed.channels[c]!;
        const notes = m.notesByStep[c]?.[m.step];
        if (!notes) continue;
        for (const n of notes) this.playNote(ctx, m.bus, ch.wave, ch.volume, n, parsed.stepSeconds, m.nextTime);
      }
      m.nextTime += parsed.stepSeconds;
      m.step++;
      if (m.step >= parsed.totalSteps) {
        if (!parsed.loop) {
          this.music = null;
          if (this.timer !== null) window.clearInterval(this.timer);
          this.timer = null;
          return;
        }
        m.step = 0;
      }
    }
  }

  private playNote(
    ctx: AudioContext,
    out: AudioNode,
    wave: Waveform,
    volume: number,
    note: ParsedNote,
    stepSeconds: number,
    when: number,
  ): void {
    const dur = Math.max(0.03, note.length * stepSeconds * 0.92);
    if (wave === 'noise') {
      this.drum(ctx, out, when, note.midi, volume);
      return;
    }
    const osc = this.oscillator(ctx, wave);
    osc.frequency.setValueAtTime(midiToFrequency(note.midi), when);
    const g = ctx.createGain();
    const peak = volume * 0.32;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.006);
    g.gain.linearRampToValueAtTime(peak * 0.72, when + Math.min(0.08, dur * 0.5));
    g.gain.setValueAtTime(peak * 0.72, when + dur - 0.025);
    g.gain.linearRampToValueAtTime(0, when + dur);
    osc.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + dur + 0.01);
    osc.onended = () => g.disconnect();
  }

  private drum(ctx: AudioContext, out: AudioNode, when: number, kind: number, volume: number): void {
    if (kind === 36) {
      this.tone(ctx, out, when, 0.12, 150, 45, volume * 0.9);
      this.noiseBurst(ctx, out, when, 0.03, 600, 'lowpass', volume * 0.4);
    } else if (kind === 38) {
      this.noiseBurst(ctx, out, when, 0.11, 1900, 'bandpass', volume * 0.8);
      this.tone(ctx, out, when, 0.05, 260, 180, volume * 0.25);
    } else if (kind === 42) {
      this.noiseBurst(ctx, out, when, 0.035, 7500, 'highpass', volume * 0.45);
    } else {
      this.noiseBurst(ctx, out, when, 0.07, 3000, 'bandpass', volume * 0.6);
    }
  }

  private playSpec(ctx: AudioContext, spec: SfxSpec, out: AudioNode, when: number): void {
    const volume = (spec.volume ?? 0.5) * 0.45;
    const dur = Math.max(0.01, spec.duration);
    const release = Math.min(dur, spec.release ?? Math.min(0.05, dur / 2));
    const g = ctx.createGain();
    g.connect(out);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(volume, when + 0.004);
    g.gain.setValueAtTime(volume, when + dur - release);
    g.gain.linearRampToValueAtTime(0, when + dur);

    const freqs = typeof spec.freq === 'number' ? [spec.freq] : spec.freq;
    const first = freqs[0] ?? 440;
    if (spec.wave === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(Math.max(40, first), when);
      if (spec.freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(40, spec.freqEnd), when + dur);
      src.connect(f).connect(g);
      src.start(when, Math.random() * 0.5);
      src.stop(when + dur + 0.02);
      src.onended = () => g.disconnect();
      return;
    }
    const osc = this.oscillator(ctx, spec.wave);
    if (freqs.length > 1) {
      const step = spec.stepDuration ?? dur / freqs.length;
      let t = when;
      let i = 0;
      while (t < when + dur) {
        const f = freqs[i % freqs.length] ?? 0;
        if (f <= 0) {
          if (t < when + dur - release) g.gain.setValueAtTime(0, t);
        } else {
          osc.frequency.setValueAtTime(f, t);
          // Restore level after a silent step (but never inside the release ramp).
          if (t > when && t < when + dur - release) g.gain.setValueAtTime(volume, t);
        }
        t += step;
        i++;
        if (i >= freqs.length) break;
      }
    } else {
      osc.frequency.setValueAtTime(Math.max(1, first), when);
      if (spec.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.freqEnd), when + dur);
    }
    osc.connect(g);
    osc.start(when);
    osc.stop(when + dur + 0.02);
    osc.onended = () => g.disconnect();
  }

  private oscillator(ctx: AudioContext, wave: Waveform): OscillatorNode {
    const osc = ctx.createOscillator();
    const pw = this.waves.get(wave);
    if (pw) osc.setPeriodicWave(pw);
    else osc.type = wave === 'triangle' ? 'triangle' : wave === 'sawtooth' ? 'sawtooth' : 'square';
    return osc;
  }

  private tone(ctx: AudioContext, out: AudioNode, when: number, dur: number, f0: number, f1: number, vol: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    osc.connect(g).connect(out);
    osc.start(when);
    osc.stop(when + dur + 0.01);
    osc.onended = () => g.disconnect();
  }

  private noiseBurst(
    ctx: AudioContext,
    out: AudioNode,
    when: number,
    dur: number,
    freq: number,
    type: BiquadFilterType,
    vol: number,
  ): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'bandpass' ? 1.2 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    src.connect(f).connect(g).connect(out);
    src.start(when, Math.random() * 0.8);
    src.stop(when + dur + 0.01);
    src.onended = () => g.disconnect();
  }

  private noiseSweep(ctx: AudioContext, out: AudioNode, when: number, dur: number, f0: number, f1: number, vol: number): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(f0, when);
    f.frequency.exponentialRampToValueAtTime(f1, when + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, when + dur);
    src.connect(f).connect(g).connect(out);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.01);
    src.onended = () => g.disconnect();
  }
}

/** Band-limited pulse wave with the given duty cycle. */
function pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const n = 48;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
    imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
  }
  return ctx.createPeriodicWave(real, imag);
}
