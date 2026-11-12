import type { Sfx, SfxName } from './sfx';

/**
 * Original sound effects synthesised at runtime with the Web Audio API (no audio files).
 * The context is created lazily on the first user gesture, as browsers require.
 * Sound is never needed to understand the simulation: every sound has a visual counterpart.
 */
export class WebAudioSfx implements Sfx {
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  muted = false;
  private lastPlayed = new Map<SfxName, number>();

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x7fffffff) * 2 - 1;
      }
    } catch {
      this.ctx = undefined;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  play(name: SfxName, opts: { volume?: number; durationMs?: number } = {}): void {
    if (this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    // Rate-limit very frequent sounds (e.g. note counting) to keep the mix clean.
    const nowMs = performance.now();
    const minGap = name === 'count' ? 45 : name === 'motor' ? 120 : 20;
    if (nowMs - (this.lastPlayed.get(name) ?? 0) < minGap) return;
    this.lastPlayed.set(name, nowMs);
    const v = opts.volume ?? 1;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'key':
        this.tone(1250, 0.045, 'square', 0.12 * v, t);
        this.noiseBurst(0.012, 4000, 0.15 * v, t);
        break;
      case 'click':
        this.noiseBurst(0.01, 3000, 0.1 * v, t);
        break;
      case 'beep':
        this.tone(1046, 0.13, 'sine', 0.25 * v, t);
        break;
      case 'error':
        this.tone(440, 0.16, 'square', 0.12 * v, t);
        this.tone(330, 0.24, 'square', 0.12 * v, t + 0.18);
        break;
      case 'count':
        this.noiseBurst(0.018, 2500, 0.18 * v, t);
        this.tone(180, 0.02, 'triangle', 0.08 * v, t);
        break;
      case 'motor':
        this.motor((opts.durationMs ?? 500) / 1000, 95, 0.09 * v, t);
        break;
      case 'card':
        this.motor((opts.durationMs ?? 800) / 1000, 140, 0.08 * v, t);
        this.noiseBurst(0.03, 1800, 0.1 * v, t + 0.02);
        break;
      case 'shutter':
        this.sweep(0.35, 300, 900, 0.07 * v, t);
        this.noiseBurst(0.04, 900, 0.14 * v, t + 0.33);
        break;
      case 'print': {
        const dur = (opts.durationMs ?? 1200) / 1000;
        for (let i = 0; i < dur / 0.035; i++) this.noiseBurst(0.012, 5000, 0.06 * v, t + i * 0.035);
        this.motor(dur, 60, 0.05 * v, t);
        break;
      }
      case 'panel':
        this.tone(70, 0.25, 'sine', 0.25 * v, t);
        this.sweep(0.5, 180, 120, 0.04 * v, t + 0.05);
        this.noiseBurst(0.06, 600, 0.2 * v, t);
        break;
    }
  }

  private env(gain: GainNode, peak: number, t: number, dur: number): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.min(0.008, dur / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    this.env(g, vol, t, dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private sweep(dur: number, f0: number, f1: number, vol: number, t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    this.env(g, vol, t, dur);
    o.connect(f).connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, cutoff: number, vol: number, t: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = cutoff;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    this.env(g, vol, t, dur);
    s.connect(f).connect(g).connect(this.master!);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  /** Electric motor: filtered noise + low hum with amplitude flutter. */
  private motor(dur: number, hum: number, vol: number, t: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + Math.max(0.07, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = hum;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const s = ctx.createBufferSource();
    s.buffer = this.noise!;
    s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    o.connect(lp).connect(g);
    s.connect(bp).connect(ng).connect(g);
    g.connect(this.master!);
    o.start(t);
    s.start(t);
    o.stop(t + dur + 0.02);
    s.stop(t + dur + 0.02);
  }
}
