#!/usr/bin/env node
// -----------------------------------------------------------------------------
// generate-audio.mjs
//
// Procedurally synthesizes every sound used by the "How Cash Works Inside an
// ATM" explainer. No samples, no downloads, no dependencies: plain Node (ESM).
//
// Output: 16-bit PCM, mono, 48 kHz WAV files in public/audio/.
// Everything is deterministic: each sound uses its own seeded PRNG, so running
// the script twice produces byte-identical files.
//
// Usage:  npm run audio      (or: node scripts/generate-audio.mjs)
// -----------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const TAU = Math.PI * 2;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'audio');

// Peak targets (dBFS): SFX sit around -6, the music bed sits well under narration.
const SFX_PEAK_DB = -6;
const MUSIC_PEAK_DB = -18;

// =============================================================================
// Basic utilities
// =============================================================================

/** Seeded PRNG (mulberry32). Returns floats in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** White noise source in [-1, 1) driven by a seeded PRNG. */
const noiseSource = (seed) => {
  const rnd = mulberry32(seed);
  return () => rnd() * 2 - 1;
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dbToAmp = (db) => Math.pow(10, db / 20);
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12); // equal temperament
const smoothstep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const makeBuf = (seconds) => new Float64Array(Math.round(seconds * SR));

/**
 * Percussive envelope: smooth (half-cosine) attack of `attack` seconds, then an
 * exponential decay with time constant `tau`. Returns 0 for t < 0.
 */
function perc(t, attack, tau) {
  if (t < 0) return 0;
  if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
  return Math.exp(-(t - attack) / tau);
}

/** Classic ADSR. `gateLen` = time the note is held before release starts. */
function adsr(t, a, d, s, r, gateLen) {
  if (t < 0) return 0;
  let v;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * ((t - a) / d);
  else v = s;
  if (t > gateLen) {
    const held = adsr(gateLen, a, d, s, r, Infinity);
    v = held * Math.max(0, 1 - (t - gateLen) / r);
  }
  return v;
}

// =============================================================================
// Oscillators (phase accumulators)
// =============================================================================

/** PolyBLEP residual: removes the step discontinuity that causes aliasing. */
function polyBlep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

class Osc {
  constructor(phase = 0) {
    this.p = phase; // phase in cycles [0, 1)
  }
  /** Advance by one sample at frequency f; returns the phase *before* advancing. */
  step(f) {
    const p = this.p;
    this.p += f / SR;
    if (this.p >= 1) this.p -= Math.floor(this.p);
    return p;
  }
  sine(f) {
    return Math.sin(TAU * this.step(f));
  }
  /** Band-limited (polyBLEP) sawtooth. */
  saw(f) {
    const p = this.step(f);
    return 2 * p - 1 - polyBlep(p, f / SR);
  }
  /** Triangle aligned with sine phase (starts at 0, rising). Harmonics fall at
   *  1/n^2, so aliasing is negligible at the pitches used here. */
  tri(f) {
    const p = this.step(f);
    return 1 - 4 * Math.abs(((p + 0.25) % 1) - 0.5);
  }
}

// =============================================================================
// Filters
// =============================================================================

/** RBJ-cookbook biquad, transposed direct form II (safe for slow sweeps). */
class Biquad {
  constructor(type = 'lowpass', freq = 1000, q = 0.707) {
    this.type = type;
    this.z1 = 0;
    this.z2 = 0;
    this.set(freq, q);
  }
  set(freq, q = this.q) {
    this.q = q;
    const f = clamp(freq, 10, SR * 0.45);
    const w0 = (TAU * f) / SR;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    let b0, b1, b2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    switch (this.type) {
      case 'lowpass':
        b0 = (1 - cos) / 2;
        b1 = 1 - cos;
        b2 = b0;
        break;
      case 'highpass':
        b0 = (1 + cos) / 2;
        b1 = -(1 + cos);
        b2 = b0;
        break;
      case 'bandpass': // constant 0 dB peak gain
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        break;
      default:
        throw new Error(`Unknown filter type ${this.type}`);
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }
  process(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** One-pole low-pass (gentle 6 dB/oct smoothing). */
class OnePole {
  constructor(freq) {
    this.a = 1 - Math.exp((-TAU * freq) / SR);
    this.y = 0;
  }
  process(x) {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/**
 * Filter a whole buffer in place. `freq` may be a number or a function of time
 * (seconds) for sweeps; coefficients are then refreshed every `step` samples.
 */
function filterBuf(buf, type, freq, q = 0.707, step = 16) {
  const sweep = typeof freq === 'function';
  const bq = new Biquad(type, sweep ? freq(0) : freq, q);
  for (let i = 0; i < buf.length; i++) {
    if (sweep && i % step === 0) bq.set(freq(i / SR));
    buf[i] = bq.process(buf[i]);
  }
  return buf;
}

// =============================================================================
// Effects
// =============================================================================

const rms = (buf) => {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
};

/** Feedback echo with a low-pass in the loop (each repeat gets darker). */
function echo(buf, delaySec, feedback, mix, lpHz = 3000) {
  const d = Math.round(delaySec * SR);
  const line = new Float64Array(d);
  const lp = new OnePole(lpHz);
  let idx = 0;
  for (let i = 0; i < buf.length; i++) {
    const delayed = line[idx];
    const x = buf[i];
    line[idx] = x + feedback * lp.process(delayed);
    idx = (idx + 1) % d;
    buf[i] = x + mix * delayed;
  }
  return buf;
}

/**
 * Small Freeverb-style mono reverb (8 damped combs + 4 allpasses). The wet
 * signal is scaled so its RMS is `wet` times the dry RMS, which keeps the
 * balance predictable regardless of the input.
 */
function reverb(buf, { wet = 0.25, room = 0.82, damp = 0.35 } = {}) {
  const scale = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({
    b: new Float64Array(Math.round(d * scale)),
    i: 0,
    s: 0,
  }));
  const aps = [556, 441, 341, 225].map((d) => ({ b: new Float64Array(Math.round(d * scale)), i: 0 }));
  const wetSig = new Float64Array(buf.length);
  for (let n = 0; n < buf.length; n++) {
    const x = buf[n];
    let acc = 0;
    for (const c of combs) {
      const y = c.b[c.i];
      c.s = y * (1 - damp) + c.s * damp; // damping = one-pole LP in the feedback
      c.b[c.i] = x + c.s * room;
      c.i = (c.i + 1) % c.b.length;
      acc += y;
    }
    for (const a of aps) {
      const bo = a.b[a.i];
      const y = -acc + bo;
      a.b[a.i] = acc + bo * 0.5;
      a.i = (a.i + 1) % a.b.length;
      acc = y;
    }
    wetSig[n] = acc;
  }
  const g = (wet * rms(buf)) / (rms(wetSig) || 1);
  for (let n = 0; n < buf.length; n++) buf[n] += g * wetSig[n];
  return buf;
}

// =============================================================================
// Finishing: fades, normalisation, loop crossfade, WAV writer
// =============================================================================

/** Raised-cosine fade in/out (seconds) to avoid clicks at the edges. */
function fade(buf, inSec, outSec) {
  const nIn = Math.round(inSec * SR);
  const nOut = Math.round(outSec * SR);
  for (let i = 0; i < nIn && i < buf.length; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nIn);
  for (let i = 0; i < nOut && i < buf.length; i++) {
    // The last sample lands exactly on 0.
    buf[buf.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, nOut - 1));
  }
  return buf;
}

function normalize(buf, peakDb) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak === 0) return buf;
  const g = dbToAmp(peakDb) / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= g;
  return buf;
}

/**
 * Make a seamless loop: `raw` holds `n + x` samples; the first `x` samples are
 * equal-power crossfaded with the overflow tail, so sample n-1 flows into
 * sample 0 exactly as it did in the continuous signal.
 */
function loopCrossfade(raw, n) {
  const x = raw.length - n;
  const out = raw.slice(0, n);
  for (let i = 0; i < x; i++) {
    const w = i / x;
    out[i] = raw[i] * Math.sin((w * Math.PI) / 2) + raw[n + i] * Math.cos((w * Math.PI) / 2);
  }
  return out;
}

/** Write a 16-bit PCM mono WAV with TPDF dither (seeded, so deterministic). */
function writeWav(path, buf, seed) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  const n = buf.length;
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16); // fmt chunk size
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(SR, 24);
  out.writeUInt32LE(SR * 2, 28); // byte rate
  out.writeUInt16LE(2, 32); // block align
  out.writeUInt16LE(16, 34); // bits per sample
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.round(buf[i] * 32767 + (rnd() - rnd()));
    out.writeInt16LE(clamp(v, -32768, 32767), 44 + i * 2);
  }
  writeFileSync(path, out);
}

// =============================================================================
// Sound effects
// =============================================================================

/** 1. Soft airy transition swoosh: noise through a band-pass that sweeps up. */
function whoosh() {
  const dur = 0.7;
  const buf = makeBuf(dur);
  const noise = noiseSource(101);
  const bpA = new Biquad('bandpass', 400, 1.1);
  const bpB = new Biquad('bandpass', 640, 1.6);
  const air = new Biquad('highpass', 3000, 0.7);
  const lp = new Biquad('lowpass', 7000, 0.6);
  for (let i = 0; i < buf.length; i++) {
    const u = i / buf.length;
    // Sweep rises to its top at 60 % of the sound, then eases back a little.
    const sweep = u < 0.6 ? Math.sin(((u / 0.6) * Math.PI) / 2) ** 2 : 1 - 0.35 * ((u - 0.6) / 0.4);
    const fc = 320 * Math.pow(10, sweep * 1.05); // ~320 Hz -> ~3.6 kHz
    if (i % 16 === 0) {
      bpA.set(fc);
      bpB.set(fc * 1.6);
    }
    const env = u < 0.6 ? Math.pow(u / 0.6, 2.2) : Math.pow(1 - (u - 0.6) / 0.4, 1.8);
    const w = noise();
    const s = bpA.process(w) + 0.5 * bpB.process(w) + 0.08 * air.process(w) * sweep;
    buf[i] = lp.process(s) * env;
  }
  return buf;
}

/** 2. Small DC motor + rubber rollers, seamlessly loopable (2.0 s). */
function rollerMotor() {
  const len = 2.0;
  const n = Math.round(len * SR);
  const xf = Math.round(0.25 * SR); // loop crossfade length
  const raw = new Float64Array(n + xf);
  const noise = noiseSource(202);
  // Motor hum: 110 Hz with a decaying harmonic series and a faint brush whine.
  const partials = [
    [1, 1.0],
    [2, 0.55],
    [3, 0.32],
    [4, 0.2],
    [5, 0.12],
    [6, 0.08],
    [8, 0.04],
    [12, 0.025],
    [15, 0.015],
  ];
  const oscs = partials.map((_, k) => new Osc((k * 0.137) % 1));
  const rollerTex = new Biquad('lowpass', 25, 0.7); // slow random roughness
  const bpHi = new Biquad('bandpass', 1100, 0.9); // light mechanical hiss
  const bpLo = new Biquad('bandpass', 210, 1.2); // rubber roller rumble
  const master = new Biquad('lowpass', 4500, 0.7);
  for (let i = 0; i < raw.length; i++) {
    const t = i / SR;
    // Gentle speed flutter (LFO rates divide the loop length evenly).
    const flutter = 1 + 0.0035 * Math.sin(TAU * 3 * t) + 0.002 * Math.sin(TAU * 7.5 * t + 1.3);
    const f0 = 110 * flutter;
    let hum = 0;
    for (let k = 0; k < partials.length; k++) hum += partials[k][1] * oscs[k].sine(f0 * partials[k][0]);
    // Roller "wobble": slight amplitude modulation at roller rotation rates.
    const wobble = 1 + 0.06 * Math.sin(TAU * 6 * t) + 0.04 * Math.sin(TAU * 13.5 * t + 0.7);
    const tex = rollerTex.process(noise()) * 8;
    const hiss = bpHi.process(noise()) * 0.16 * (1 + 0.5 * tex);
    const rumble = bpLo.process(noise()) * 0.4 * (0.8 + 0.2 * Math.sin(TAU * 4.5 * t));
    raw[i] = master.process(0.45 * hum * wobble + hiss + rumble);
  }
  filterBuf(raw, 'highpass', 40, 0.7);
  return loopCrossfade(raw, n); // no edge fades: the file must loop cleanly
}

/** 3. Crisp paper flick/snap as a note is pulled off the stack. */
function billPick() {
  const buf = makeBuf(0.25);
  const noise = noiseSource(303);
  const friction = new Biquad('bandpass', 2600, 0.8);
  const snapHp = new Biquad('highpass', 1800, 0.7);
  const crisp = new Biquad('bandpass', 4200, 1.2);
  const t0 = 0.055; // moment the note snaps free
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const w = noise();
    // Short friction drag building up to the snap.
    const fricEnv = t < t0 ? 0.25 * (t / t0) ** 2 : 0.25 * Math.exp(-(t - t0) / 0.01);
    const snap = perc(t - t0, 0.0008, 0.011);
    const flick2 = 0.45 * perc(t - 0.072, 0.0005, 0.008); // paper edge flicks back
    const tail = 0.12 * perc(t - 0.06, 0.01, 0.05); // brief rustle tail
    const body = 0.25 * Math.sin(TAU * 190 * Math.max(0, t - t0)) * perc(t - t0, 0.001, 0.018);
    buf[i] =
      friction.process(w) * fricEnv +
      snapHp.process(w) * (snap + flick2) +
      crisp.process(w) * (0.6 * snap + tail) +
      body;
  }
  filterBuf(buf, 'lowpass', 11000, 0.7);
  return fade(buf, 0.002, 0.02);
}

/** 4. Short paper glide across the transport belts (soft rustle). */
function billTransport() {
  const dur = 0.5;
  const buf = makeBuf(dur);
  const noise = noiseSource(404);
  const grainNoise = noiseSource(405);
  const bp = new Biquad('bandpass', 2000, 0.7);
  const low = new Biquad('bandpass', 450, 0.9);
  const grainLp = new Biquad('lowpass', 45, 0.7); // slow random "grain" of the rustle
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const u = t / dur;
    const fc = 1800 + 1400 * Math.sin(Math.PI * u); // slight doppler-like rise/fall
    if (i % 16 === 0) bp.set(fc);
    const env = smoothstep(u / 0.25) * (1 - smoothstep((u - 0.55) / 0.45));
    const grain = 0.55 + 0.45 * clamp(Math.abs(grainLp.process(grainNoise()) * 14), 0, 1);
    const w = noise();
    buf[i] = (bp.process(w) + 0.35 * low.process(w)) * env * grain;
  }
  filterBuf(buf, 'lowpass', 8000, 0.7);
  return fade(buf, 0.003, 0.02);
}

/** 5. Soft precise electronic tick (optical sensor detects a note). */
function sensorTick() {
  const buf = makeBuf(0.12);
  const noise = noiseSource(505);
  const click = new Biquad('highpass', 6000, 0.7);
  const f = midiToHz(100); // E7, ~2637 Hz
  const o1 = new Osc();
  const o2 = new Osc();
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    buf[i] =
      o1.sine(f) * perc(t, 0.0015, 0.018) +
      0.25 * o2.sine(f * 2) * perc(t, 0.001, 0.007) +
      0.08 * click.process(noise()) * perc(t, 0.0003, 0.002);
  }
  return fade(buf, 0.0005, 0.02);
}

/** 6. Tiny mechanical counter click (click + clack). */
function counterTick() {
  const buf = makeBuf(0.08);
  const noise = noiseSource(606);
  const hp = new Biquad('highpass', 2500, 0.7);
  const ringHi = new Biquad('bandpass', 3800, 10); // small metal part ringing
  const ringLo = new Biquad('bandpass', 1300, 6); // plastic body
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const exc = noise() * (perc(t - 0.004, 0.0002, 0.0012) + 0.55 * perc(t - 0.016, 0.0002, 0.001));
    buf[i] = hp.process(exc) * 0.6 + ringHi.process(exc) * 1.4 + ringLo.process(exc) * 0.9;
  }
  return fade(buf, 0.001, 0.015);
}

/** 7. Note landing on the stack: papery tap with a soft low body. */
function stackTap() {
  const buf = makeBuf(0.2);
  const noise = noiseSource(707);
  const paper = new Biquad('bandpass', 1600, 0.9);
  const air = new Biquad('highpass', 4000, 0.7);
  const thump = new Biquad('lowpass', 250, 0.7);
  const body = new Osc();
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const w = noise();
    const fBody = 95 + 45 * Math.exp(-t / 0.02); // quick pitch drop 140 -> 95 Hz
    buf[i] =
      paper.process(w) * (perc(t, 0.0008, 0.014) + 0.25 * perc(t - 0.035, 0.002, 0.02)) +
      0.3 * air.process(w) * perc(t, 0.0005, 0.006) +
      1.6 * thump.process(w) * perc(t, 0.001, 0.03) +
      0.5 * body.sine(fBody) * perc(t, 0.002, 0.045);
  }
  filterBuf(buf, 'highpass', 35, 0.7);
  return fade(buf, 0.001, 0.03);
}

/** 8. Small motorized shutter sliding open: motor whirr then a soft end clunk. */
function shutter() {
  const buf = makeBuf(0.6);
  const noise = noiseSource(808);
  const motor = new Osc();
  const motorSine = new Osc(0.25);
  const motorLp = new Biquad('lowpass', 1400, 0.9);
  const slide = new Biquad('bandpass', 2000, 0.7);
  const clunkLp = new Biquad('lowpass', 400, 0.7);
  const knock = new Biquad('bandpass', 700, 2);
  const clunkOsc = new Osc();
  const tEnd = 0.45; // shutter hits its end stop
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const w = noise();
    // Motor speeds up, then sags slightly as it reaches the end of travel.
    const f = 150 + 80 * smoothstep(t / 0.25) - 20 * smoothstep((t - 0.35) / 0.1);
    // Motor gated on for 0.4 s: quick spin-up, slight settle, short spin-down.
    const motorEnv = adsr(t, 0.03, 0.06, 0.85, 0.06, 0.4);
    const gearBuzz = 1 + 0.25 * Math.sin(TAU * 38 * t);
    const whirr = motorLp.process(0.5 * motor.saw(f) + 0.5 * motorSine.sine(f)) * gearBuzz;
    const friction = slide.process(w) * 0.12;
    const tc = t - tEnd;
    const clunk =
      0.9 * clunkOsc.sine(70 + 20 * Math.exp(-Math.max(0, tc) / 0.02)) * perc(tc, 0.002, 0.05) +
      1.2 * clunkLp.process(w) * perc(tc, 0.001, 0.02) +
      0.4 * knock.process(w) * perc(tc, 0.001, 0.025);
    buf[i] = (whirr + friction) * motorEnv * 0.6 + clunk;
  }
  filterBuf(buf, 'highpass', 35, 0.7);
  return fade(buf, 0.003, 0.04);
}

/** 9. Touchscreen tap confirm: tiny tap + soft rounded pop. */
function uiTap() {
  const buf = makeBuf(0.15);
  const noise = noiseSource(909);
  const tapLp = new Biquad('lowpass', 3000, 0.7);
  const o1 = new Osc();
  const o2 = new Osc();
  const o3 = new Osc();
  const f = midiToHz(84); // C6
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const fGlide = f * (1 + 0.08 * Math.exp(-t / 0.004)); // tiny settle into pitch
    buf[i] =
      0.4 * tapLp.process(noise()) * perc(t, 0.0005, 0.003) +
      o1.sine(fGlide) * perc(t, 0.002, 0.035) +
      0.2 * o2.sine(fGlide * 2) * perc(t, 0.002, 0.015) +
      0.45 * o3.sine(midiToHz(91)) * perc(t - 0.045, 0.002, 0.03); // faint G6 confirm
  }
  return fade(buf, 0.0005, 0.02);
}

/** 10. Digital "data packet" blip with a quick upward glide. */
function dataPulse() {
  const buf = makeBuf(0.35);
  const o1 = new Osc();
  const o2 = new Osc();
  const o3 = new Osc();
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const f = 600 * Math.pow(1600 / 600, smoothstep(t / 0.11)); // 600 -> 1600 Hz
    const env = smoothstep(t / 0.008) * (t < 0.08 ? 1 : Math.exp(-(t - 0.08) / 0.06));
    const shimmer = 1 + 0.12 * Math.sin(TAU * 42 * t);
    buf[i] = (o1.sine(f) + 0.3 * o2.tri(f) + 0.25 * o3.sine(f / 2)) * env * shimmer;
  }
  filterBuf(buf, 'lowpass', 5000, 0.7);
  echo(buf, 0.085, 0.25, 0.35, 2500);
  reverb(buf, { wet: 0.2, room: 0.7, damp: 0.4 });
  return fade(buf, 0.001, 0.04);
}

/** 11. Pleasant two-note approval chime: F5 then A5 (a major third). */
function approveChime() {
  const buf = makeBuf(0.9);
  const notes = [
    { t0: 0.0, f: midiToHz(77), g: 0.85, tau: 0.4 }, // F5
    { t0: 0.13, f: midiToHz(81), g: 1.0, tau: 0.32 }, // A5
  ];
  // [frequency ratio, gain, decay-time multiplier]; 4.17 is a soft bell-like inharmonic.
  const partials = [
    [1, 1.0, 1.0],
    [2, 0.22, 0.45],
    [3, 0.06, 0.25],
    [4.17, 0.05, 0.18],
  ];
  for (const nt of notes) {
    const oscs = partials.map(() => new Osc());
    const triOsc = new Osc();
    for (let i = Math.round(nt.t0 * SR); i < buf.length; i++) {
      const tt = i / SR - nt.t0;
      let s = 0.15 * triOsc.tri(nt.f) * perc(tt, 0.003, nt.tau * 0.6);
      for (let k = 0; k < partials.length; k++) {
        const [ratio, g, tm] = partials[k];
        s += g * oscs[k].sine(nt.f * ratio) * perc(tt, 0.003, nt.tau * tm);
      }
      buf[i] += nt.g * s;
    }
  }
  reverb(buf, { wet: 0.28, room: 0.78, damp: 0.4 });
  return fade(buf, 0.0005, 0.08);
}

/** 12. Gentle low two-tone notice (D4 -> Bb3), soft and non-alarming. */
function alertSoft() {
  const buf = makeBuf(0.4);
  const notes = [
    { t0: 0.0, f: midiToHz(62), tau: 0.07 }, // D4
    { t0: 0.16, f: midiToHz(58), tau: 0.09 }, // Bb3
  ];
  for (const nt of notes) {
    const o1 = new Osc();
    const o2 = new Osc();
    const o3 = new Osc();
    for (let i = Math.round(nt.t0 * SR); i < buf.length; i++) {
      const tt = i / SR - nt.t0;
      const env = smoothstep(tt / 0.012) * (tt < 0.07 ? 1 : Math.exp(-(tt - 0.07) / nt.tau));
      buf[i] += (o1.sine(nt.f) + 0.3 * o2.sine(nt.f * 2) + 0.1 * o3.tri(nt.f * 3)) * env;
    }
  }
  filterBuf(buf, 'lowpass', 2500, 0.7);
  reverb(buf, { wet: 0.15, room: 0.7, damp: 0.5 });
  return fade(buf, 0.001, 0.05);
}

// =============================================================================
// Music bed
// =============================================================================

/**
 * 13. Understated corporate-tech ambient bed, exactly 60.0 s.
 *  - 96 BPM, 4/4: 1 bar = 2.5 s, 24 bars total.
 *  - Dm9 | Bbmaj9 | Fadd9 | C(add9)/E, 4 bars each, then Dm9 | Bbmaj9 again.
 *  - Warm detuned-saw/triangle pad through a slowly moving low-pass.
 *  - Soft plucked 8th-note arpeggio of chord tones (no melody), dotted-8th echo.
 *  - Light low thump on beats 1 and 3 from ~6 s.
 */
function musicBed() {
  const DUR = 60;
  const N = DUR * SR; // exactly 2,880,000 samples
  const BPM = 96;
  const beat = 60 / BPM; // 0.625 s
  const bar = 4 * beat; // 2.5 s
  const eighth = beat / 2;
  const segLen = 4 * bar; // 10 s per chord

  // MIDI notes. Pads keep common tones between chords for smooth voice-leading.
  const chords = [
    { name: 'Dm9', bass: 38, pad: [53, 57, 60, 64], arp: [62, 65, 69, 76] }, // D2 | F3 A3 C4 E4
    { name: 'Bbmaj9', bass: 34, pad: [50, 53, 57, 60], arp: [58, 62, 65, 69] }, // Bb1 | D3 F3 A3 C4
    { name: 'Fadd9', bass: 41, pad: [53, 57, 60, 67], arp: [60, 65, 67, 69] }, // F2 | F3 A3 C4 G4
    { name: 'C/E', bass: 40, pad: [52, 55, 60, 62], arp: [60, 64, 67, 72] }, // E2 | E3 G3 C4 D4
  ];
  const segments = [];
  for (let k = 0; k * segLen < DUR; k++) segments.push({ start: k * segLen, chord: chords[k % chords.length] });
  const chordAt = (t) => segments[Math.min(segments.length - 1, Math.floor(t / segLen))].chord;

  const rnd = mulberry32(1313);

  /** Crossfade window for a segment, centred slightly before each downbeat. */
  const segEnv = (t, start, end, xf, first) => {
    const a = start - xf * 0.3;
    const b = end - xf * 0.3;
    if (t < a || t > b + xf) return 0;
    if (!first && t < a + xf) return Math.sin(((t - a) / xf) * (Math.PI / 2)) ** 2;
    if (t < b) return 1;
    return Math.cos(((t - b) / xf) * (Math.PI / 2)) ** 2;
  };

  // ---- Pad: 3 detuned polyBLEP saws + 1 triangle per chord tone -------------
  const pad = new Float64Array(N);
  const DETUNE = [-8, 0, 8]; // cents
  const PAD_XF = 1.2;
  segments.forEach((seg, k) => {
    const start = seg.start;
    const end = Math.min(DUR, start + segLen);
    const i0 = Math.max(0, Math.floor((start - PAD_XF * 0.3) * SR));
    const i1 = Math.min(N, Math.ceil((end + PAD_XF) * SR));
    for (const note of seg.chord.pad) {
      const base = midiToHz(note);
      const saws = DETUNE.map(() => new Osc(rnd()));
      const tri = new Osc(rnd());
      const driftPhase = rnd() * TAU;
      const driftRate = 0.08 + rnd() * 0.1;
      let drift = 1;
      for (let i = i0; i < i1; i++) {
        const t = i / SR;
        if (i % 64 === 0) drift = Math.pow(2, (1.5 * Math.sin(TAU * driftRate * t + driftPhase)) / 1200);
        const f = base * drift;
        let s = 0;
        for (let d = 0; d < DETUNE.length; d++) s += saws[d].saw(f * Math.pow(2, DETUNE[d] / 1200));
        s = s / DETUNE.length + 0.5 * tri.tri(f);
        pad[i] += 0.25 * s * segEnv(t, start, end, PAD_XF, k === 0);
      }
    }
  });
  // Slowly evolving low-pass: opens over the first 20 s and breathes gently.
  const padCut = (t) => (800 + 500 * Math.min(1, t / 20)) * (1 + 0.25 * Math.sin((TAU * t) / 12.5));
  filterBuf(pad, 'lowpass', padCut, 0.55, 32);
  filterBuf(pad, 'lowpass', padCut, 0.7, 32); // second stage: 24 dB/oct, no fizz
  filterBuf(pad, 'highpass', 90, 0.7); // leave the low end to bass + thump

  // ---- Bass: soft sine on the chord root --------------------------------------
  const bass = new Float64Array(N);
  segments.forEach((seg, k) => {
    const start = seg.start;
    const end = Math.min(DUR, start + segLen);
    const f = midiToHz(seg.chord.bass);
    const o1 = new Osc();
    const o2 = new Osc();
    const i0 = Math.max(0, Math.floor((start - 0.18) * SR));
    const i1 = Math.min(N, Math.ceil((end + 0.6) * SR));
    for (let i = i0; i < i1; i++) {
      const t = i / SR;
      bass[i] += (o1.sine(f) + 0.15 * o2.sine(2 * f)) * segEnv(t, start, end, 0.6, k === 0);
    }
  });
  filterBuf(bass, 'lowpass', 300, 0.7);

  // ---- Arpeggio: soft triangle/sine plucks in 8ths -----------------------------
  const arp = new Float64Array(N);
  const PATTERN = [0, 2, 1, 3, 0, 2, 1, 2];
  const ARP_START = bar; // enters on bar 2, fades up over 4 bars
  const PLUCK_LEN = 0.6;
  for (let e = 0; e * eighth < DUR; e++) {
    const te = e * eighth;
    if (te < ARP_START) continue;
    const chord = chordAt(te + 0.01);
    const f = midiToHz(chord.arp[PATTERN[e % 8]]);
    const accent = e % 2 === 0 ? 1.0 : 0.72; // gentle pulse on the beat
    const ramp = smoothstep((te - ARP_START) / (4 * bar));
    const g = accent * (0.35 + 0.65 * ramp);
    const oT = new Osc();
    const oS = new Osc();
    const i0 = Math.round(te * SR);
    const i1 = Math.min(N, i0 + Math.round(PLUCK_LEN * SR));
    for (let i = i0; i < i1; i++) {
      const tt = i / SR - te;
      arp[i] += g * (0.6 * oT.tri(f) + 0.4 * oS.sine(f)) * perc(tt, 0.004, 0.16);
    }
  }
  filterBuf(arp, 'lowpass', 2200, 0.7);
  echo(arp, 3 * eighth, 0.35, 0.3, 1800); // dotted-8th echo

  // ---- Low thump on beats 1 and 3 from ~6 s ------------------------------------
  const kick = new Float64Array(N);
  const KICK_START = 6.0;
  for (let b = 0; b * beat < DUR; b += 2) {
    const tk = b * beat;
    if (tk < KICK_START) continue;
    const ramp = smoothstep((tk - KICK_START) / (2 * bar)); // ease in
    const o = new Osc();
    const i0 = Math.round(tk * SR);
    const i1 = Math.min(N, i0 + Math.round(0.5 * SR));
    for (let i = i0; i < i1; i++) {
      const tt = i / SR - tk;
      const f = 48 + 70 * Math.exp(-tt / 0.03);
      kick[i] += (0.5 + 0.5 * ramp) * o.sine(f) * perc(tt, 0.002, 0.11);
    }
  }
  filterBuf(kick, 'lowpass', 180, 0.7);

  // ---- Mix ---------------------------------------------------------------------
  // Balance by RMS so the layer relationships are independent of raw levels.
  const padR = rms(pad);
  const scaleTo = (buf, target) => {
    const g = target / (rms(buf) || 1);
    for (let i = 0; i < buf.length; i++) buf[i] *= g;
  };
  scaleTo(bass, padR * 0.45);
  scaleTo(arp, padR * 0.24);
  scaleTo(kick, padR * 0.22);

  // Reverb send on pad + arp only (keeps low end tight).
  const space = new Float64Array(N);
  for (let i = 0; i < N; i++) space[i] = pad[i] + arp[i];
  reverb(space, { wet: 0.45, room: 0.86, damp: 0.45 });

  const mix = new Float64Array(N);
  for (let i = 0; i < N; i++) mix[i] = space[i] + bass[i] + kick[i];
  filterBuf(mix, 'highpass', 28, 0.7);
  fade(mix, 2.0, 2.5); // ends at exactly 0 on sample 2,879,999
  return mix;
}

// =============================================================================
// Main
// =============================================================================

const SOUNDS = [
  { file: 'whoosh.wav', make: whoosh, peak: SFX_PEAK_DB },
  { file: 'roller-motor.wav', make: rollerMotor, peak: SFX_PEAK_DB },
  { file: 'bill-pick.wav', make: billPick, peak: SFX_PEAK_DB },
  { file: 'bill-transport.wav', make: billTransport, peak: SFX_PEAK_DB },
  { file: 'sensor-tick.wav', make: sensorTick, peak: SFX_PEAK_DB },
  { file: 'counter-tick.wav', make: counterTick, peak: SFX_PEAK_DB },
  { file: 'stack-tap.wav', make: stackTap, peak: SFX_PEAK_DB },
  { file: 'shutter.wav', make: shutter, peak: SFX_PEAK_DB },
  { file: 'ui-tap.wav', make: uiTap, peak: SFX_PEAK_DB },
  { file: 'data-pulse.wav', make: dataPulse, peak: SFX_PEAK_DB },
  { file: 'approve-chime.wav', make: approveChime, peak: SFX_PEAK_DB },
  { file: 'alert-soft.wav', make: alertSoft, peak: SFX_PEAK_DB },
  { file: 'music-bed.wav', make: musicBed, peak: MUSIC_PEAK_DB },
];

mkdirSync(OUT_DIR, { recursive: true });
const started = Date.now();
SOUNDS.forEach(({ file, make, peak }, idx) => {
  const t = Date.now();
  const buf = normalize(make(), peak);
  writeWav(join(OUT_DIR, file), buf, 7000 + idx);
  const secs = (buf.length / SR).toFixed(3);
  console.log(`  ${file.padEnd(20)} ${secs.padStart(7)} s  peak ${peak} dBFS  (${Date.now() - t} ms)`);
});
console.log(`Wrote ${SOUNDS.length} files to ${OUT_DIR} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
