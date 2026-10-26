#!/usr/bin/env python3
"""Brightmeadow procedural audio generator.

Every sound effect and both music loops are synthesised from scratch here with numpy
(additive / FM oscillators, envelopes, FFT-filtered noise, numpy reverb and delay).
No samples or downloaded assets are used. All randomness comes from fixed seeds, so
re-running produces byte-identical files.

Outputs (see docs/ASSET_CONTRACT.md, section "Audio") go to game/assets/audio/:
  SFX   : mono 44.1 kHz 16-bit PCM WAV
  Music : stereo 44.1 kHz OGG Vorbis (q5), seamless loops (rendered circularly, tails folded)

Usage:  python assets/audio/synth_audio.py [--out DIR]
Needs:  numpy, and ffmpeg (with libvorbis) on PATH for the OGG encode.
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
APP_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = APP_ROOT / "game" / "assets" / "audio"

# Peak targets in dBFS. SFX are normalised to about -1 dBFS; a few very frequent, small
# sounds are deliberately quieter. Music sits lower (about -3 dBFS).
SFX_PEAK_DB = {
    "jump": -1.0,
    "coin": -1.0,
    "stomp": -1.0,
    "hurt": -1.0,
    "checkpoint": -1.0,
    "land": -9.0,       # contract: "soft landing thud (quiet)"; plays on every landing
    "fall": -1.0,
    "level_complete": -1.0,
    "game_over": -1.0,
    "ui_move": -4.0,    # tiny tick, repeats rapidly while scrolling menus
    "ui_select": -1.0,
}
MUSIC_PEAK_DB = -3.0
# Vorbis can overshoot the PCM peak slightly; aim a little lower before encoding.
MUSIC_PRE_ENCODE_PEAK_DB = -3.3


# ----------------------------------------------------------------------------------------
# Basic DSP helpers
# ----------------------------------------------------------------------------------------

def db_to_lin(db: float) -> float:
    return 10.0 ** (db / 20.0)


def midi_hz(m: float) -> float:
    return 440.0 * 2.0 ** ((m - 69.0) / 12.0)


def taxis(n: int) -> np.ndarray:
    return np.arange(n, dtype=np.float64) / SR


def nsamp(seconds: float) -> int:
    return int(round(seconds * SR))


def phase_from_freq(freq: np.ndarray) -> np.ndarray:
    """Integrate an instantaneous-frequency curve (Hz) into phase (radians), starting at 0."""
    ph = 2.0 * np.pi * np.cumsum(freq) / SR
    return ph - ph[0]


def raised_cos_attack(n: int, attack: float) -> np.ndarray:
    a = np.ones(n)
    na = min(n, max(1, nsamp(attack)))
    a[:na] = 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)
    return a


def env_ad(n: int, attack: float, tau: float) -> np.ndarray:
    """Raised-cosine attack then exponential decay with time constant tau."""
    t = taxis(n)
    return raised_cos_attack(n, attack) * np.exp(-np.maximum(t - attack, 0.0) / tau)


def env_asr(n: int, attack: float, hold: float, release: float) -> np.ndarray:
    """Attack, sustain until `hold` seconds, then raised-cosine release."""
    e = raised_cos_attack(n, attack)
    t = taxis(n)
    rel = np.clip((t - hold) / max(release, 1e-6), 0.0, 1.0)
    return e * (0.5 + 0.5 * np.cos(np.pi * rel))


def edge_fades(x: np.ndarray, fin: float = 0.002, fout: float = 0.012) -> np.ndarray:
    x = x.copy()
    ni, no = max(1, nsamp(fin)), max(1, nsamp(fout))
    x[:ni] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(ni) / ni)
    x[-no:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(1, no + 1) / no)
    return x


def _fft_filter(x: np.ndarray, resp, circular: bool) -> np.ndarray:
    """Zero-phase FFT filter. Circular mode wraps (used for loops); otherwise zero-padded."""
    n = x.shape[-1]
    nfft = n if circular else int(2 ** np.ceil(np.log2(n * 2)))
    f = np.fft.rfftfreq(nfft, 1.0 / SR)
    h = resp(f)
    y = np.fft.irfft(np.fft.rfft(x, nfft, axis=-1) * h, nfft, axis=-1)
    return y[..., :n]


def lowpass(x, fc, order=2, circular=False):
    return _fft_filter(x, lambda f: 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order)), circular)


def highpass(x, fc, order=2, circular=False):
    def r(f):
        f = np.maximum(f, 1e-3)
        return 1.0 / np.sqrt(1.0 + (fc / f) ** (2 * order))
    return _fft_filter(x, r, circular)


def bandpass(x, lo, hi, order=2, circular=False):
    def r(f):
        fs = np.maximum(f, 1e-3)
        return (1.0 / np.sqrt(1.0 + (f / hi) ** (2 * order))) / np.sqrt(1.0 + (lo / fs) ** (2 * order))
    return _fft_filter(x, r, circular)


def noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def convolve(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Linear FFT convolution, output length len(x) + len(ir) - 1."""
    n = len(x) + len(ir) - 1
    nfft = int(2 ** np.ceil(np.log2(n)))
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:n]


def make_reverb_ir(seconds: float, tau: float, seed: int, predelay: float = 0.012,
                   bright_hz: float = 6000.0, dark_hz: float = 1800.0) -> np.ndarray:
    """Exponentially decaying filtered-noise impulse response (brighter early, darker late)."""
    n = nsamp(seconds)
    t = taxis(n)
    early = lowpass(noise(n, seed), bright_hz) * np.exp(-t / (tau * 0.6))
    late = lowpass(noise(n, seed + 1), dark_hz) * np.exp(-t / tau)
    ir = 0.6 * early + 1.0 * late
    ir *= raised_cos_attack(n, 0.004)
    ir = np.concatenate([np.zeros(nsamp(predelay)), ir])
    ir = edge_fades(ir, 0.0005, 0.05)
    return ir / np.sqrt(np.sum(ir ** 2))


# ----------------------------------------------------------------------------------------
# Instruments (mono note generators). All partials kept well below Nyquist.
# ----------------------------------------------------------------------------------------

_CLICK = lowpass(noise(nsamp(0.012), 9001), 3500.0) * np.exp(-taxis(nsamp(0.012)) / 0.0025)
_CLICK /= np.max(np.abs(_CLICK))


def _partials(f, n, parts):
    t = taxis(n)
    y = np.zeros(n)
    for ratio, amp, tau in parts:
        if f * ratio < 15000.0 and amp > 0:
            y += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / tau)
    return y


def _damp_after(y, length):
    """Extra fast decay after the written note length so struck notes don't smear."""
    if length is None:
        return y
    t = taxis(len(y))
    return y * np.exp(-np.maximum(t - length, 0.0) / 0.09)


def marimba(f, length=None, bright=1.0, ring=1.0):
    tau = ring * float(np.clip(0.75 * np.sqrt(262.0 / f), 0.16, 1.1))
    n = nsamp(min(tau * 5.0, 2.6))
    y = _partials(f, n, [(1.0, 1.0, tau), (3.93, 0.30 * bright, tau * 0.16),
                         (9.2, 0.08 * bright, tau * 0.05), (2.0, 0.06, tau * 0.4)])
    y[:len(_CLICK)] += 0.06 * bright * _CLICK
    y *= raised_cos_attack(n, 0.0015)
    return _damp_after(y, length)


def kalimba(f, length=None, ring=1.0):
    tau = ring * float(np.clip(1.0 * np.sqrt(262.0 / f), 0.25, 1.4))
    n = nsamp(min(tau * 4.5, 2.6))
    t = taxis(n)
    # Gentle FM pluck: brief bright attack that settles to a nearly pure tone.
    idx = 1.1 * np.exp(-t / 0.025)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * 2.0 * f * t)) * np.exp(-t / tau)
    y += _partials(f, n, [(6.1, 0.12, tau * 0.08), (3.0, 0.05, tau * 0.3)])
    y *= raised_cos_attack(n, 0.002)
    return _damp_after(y, length)


def glock(f, length=None, ring=1.0):
    tau = ring * 0.9
    n = nsamp(min(tau * 4.0, 2.6))
    y = _partials(f, n, [(1.0, 1.0, tau), (2.76, 0.30, tau * 0.25),
                         (5.40, 0.12, tau * 0.08), (8.93, 0.04, tau * 0.04)])
    y *= raised_cos_attack(n, 0.001)
    return _damp_after(y, length)


def bass(f, length):
    n = nsamp(length + 0.08)
    t = taxis(n)
    y = (np.sin(2 * np.pi * f * t) + 0.32 * np.sin(4 * np.pi * f * t)
         + 0.10 * np.sin(6 * np.pi * f * t))
    # little pluck at the start: upper harmonics that die quickly
    y += np.exp(-t / 0.03) * (0.18 * np.sin(8 * np.pi * f * t) + 0.08 * np.sin(10 * np.pi * f * t))
    env = raised_cos_attack(n, 0.006) * (0.6 + 0.4 * np.exp(-t / 0.12))
    env *= env_asr(n, 0.0, length, 0.07)
    return y * env


def pad_voice(f, length, detune_cents):
    """Band-limited soft saw, slow attack/release."""
    n = nsamp(length + 0.6)
    t = taxis(n)
    ff = f * 2 ** (detune_cents / 1200.0)
    y = np.zeros(n)
    k = 1
    while ff * k < 5000.0 and k <= 12:
        y += np.sin(2 * np.pi * ff * k * t + 0.7 * k) / k ** 1.7
        k += 1
    return y * env_asr(n, 0.25, length, 0.55)


def kick():
    n = nsamp(0.32)
    t = taxis(n)
    fr = 48.0 + 120.0 * np.exp(-t / 0.03)
    y = np.sin(phase_from_freq(fr)) * np.exp(-t / 0.11)
    y[:len(_CLICK)] += 0.08 * _CLICK
    return edge_fades(y * raised_cos_attack(n, 0.001), 0.0005, 0.02)


def snare():
    n = nsamp(0.28)
    t = taxis(n)
    tone = 0.45 * np.sin(2 * np.pi * 195.0 * t) * np.exp(-t / 0.05)
    nz = bandpass(noise(n, 4242), 1200.0, 6500.0) * np.exp(-t / 0.075)
    nz /= np.max(np.abs(nz))
    y = tone + 0.8 * nz
    return edge_fades(y * raised_cos_attack(n, 0.0015), 0.0005, 0.03)


def shaker(seed=777):
    n = nsamp(0.09)
    t = taxis(n)
    nz = bandpass(noise(n, seed), 5000.0, 11000.0)
    nz /= np.max(np.abs(nz))
    env = raised_cos_attack(n, 0.010) * np.exp(-np.maximum(t - 0.010, 0) / 0.022)
    return edge_fades(nz * env, 0.0005, 0.01)


def woodblock(f=1250.0):
    n = nsamp(0.12)
    y = _partials(f, n, [(1.0, 1.0, 0.035), (2.7, 0.3, 0.012)])
    y[:len(_CLICK)] += 0.15 * _CLICK
    return edge_fades(y * raised_cos_attack(n, 0.0008), 0.0005, 0.02)


# ----------------------------------------------------------------------------------------
# Sound effects (mono)
# ----------------------------------------------------------------------------------------

def place_mono(buf, t0, sig, gain=1.0):
    i = nsamp(t0)
    j = min(len(buf), i + len(sig))
    buf[i:j] += gain * sig[: j - i]


def sfx_jump():
    n = nsamp(0.28)
    t = taxis(n)
    f = 330.0 * 2 ** (1.1 * (1 - np.exp(-t / 0.06)))       # quick upward sweep ~330 -> 700 Hz
    ph = phase_from_freq(f)
    fm = 0.8 * np.exp(-t / 0.04)                              # chiptune-ish brightness only at the start
    y = np.sin(ph + fm * np.sin(2 * ph)) + 0.12 * np.sin(2 * ph) * np.exp(-t / 0.05)
    y *= env_ad(n, 0.012, 0.085)
    sparkle = marimba(midi_hz(84))[:n]                        # soft toybox ping on top
    y += 0.18 * sparkle
    return y


def _chime(f, n, tau, shimmer_hz=4.0):
    t = taxis(n)
    y = np.zeros(n)
    for ratio, amp, tr in [(1.0, 1.0, 1.0), (2.0, 0.30, 0.5), (3.0, 0.12, 0.3), (4.16, 0.05, 0.15)]:
        if f * ratio < 15000:
            y += amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t / (tau * tr))
    # detuned twin -> gentle beating shimmer
    y += 0.45 * np.sin(2 * np.pi * (f + shimmer_hz) * t) * np.exp(-t / tau)
    return y * raised_cos_attack(n, 0.0015)


def sfx_coin():
    total = nsamp(0.62)
    y = np.zeros(total)
    n1 = _chime(midi_hz(83), nsamp(0.10), 0.06)               # B5
    n1 = edge_fades(n1, 0.0015, 0.025)
    place_mono(y, 0.0, n1, 0.85)
    n2 = _chime(midi_hz(88), total - nsamp(0.075), 0.22)      # E6
    place_mono(y, 0.075, n2, 1.0)
    t = taxis(total)
    sparkle = np.sin(2 * np.pi * midi_hz(100) * t) * np.exp(-np.maximum(t - 0.08, 0) / 0.08)
    sparkle *= (t > 0.075) * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * t))
    y += 0.07 * sparkle
    return y


def sfx_stomp():
    n = nsamp(0.36)
    t = taxis(n)
    thump = np.sin(phase_from_freq(60 + 180 * np.exp(-t / 0.03))) * np.exp(-t / 0.07)
    fb = 240.0 * (1 + 0.6 * (1 - np.exp(-t / 0.05))) * (1 + 0.07 * np.sin(2 * np.pi * 21 * t) * np.exp(-t / 0.18))
    ph = phase_from_freq(fb)
    boing = (np.sin(ph) + 0.25 * np.sin(2 * ph)) * env_ad(n, 0.006, 0.11)
    squish = bandpass(noise(n, 31), 180.0, 1400.0) * np.exp(-t / 0.03)
    squish /= np.max(np.abs(squish))
    y = 0.9 * thump + 0.6 * boing + 0.35 * squish
    return y * raised_cos_attack(n, 0.002)


def sfx_hurt():
    n = nsamp(0.5)
    t = taxis(n)
    f = 620.0 * 2 ** (-1.1 * t / 0.45) * (1 + 0.06 * np.sin(2 * np.pi * 11 * t))
    ph = phase_from_freq(f)
    y = np.sin(ph) + 0.28 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph)
    trem = 1.0 - 0.3 * (0.5 + 0.5 * np.sin(2 * np.pi * 11 * t))
    return y * trem * env_ad(n, 0.006, 0.28)


def sfx_checkpoint():
    total = nsamp(1.05)
    y = np.zeros(total)
    notes = [79, 83, 86, 91]  # G5 B5 D6 G6 rising arpeggio
    for i, m in enumerate(notes):
        last = i == len(notes) - 1
        f = midi_hz(m)
        place_mono(y, 0.07 * i, marimba(f, ring=1.4 if last else 0.8), 0.7)
        place_mono(y, 0.07 * i, glock(f, ring=0.8 if last else 0.25), 0.35 if last else 0.2)
    t = taxis(total)
    shimmer = (np.sin(2 * np.pi * midi_hz(95) * t) + np.sin(2 * np.pi * (midi_hz(95) + 5) * t))
    shimmer *= np.exp(-np.maximum(t - 0.25, 0) / 0.2) * (t > 0.24)
    y += 0.05 * shimmer
    return y


def sfx_land():
    n = nsamp(0.18)
    t = taxis(n)
    thud = np.sin(phase_from_freq(55 + 90 * np.exp(-t / 0.02))) * env_ad(n, 0.002, 0.045)
    puff = lowpass(noise(n, 55), 700.0) * np.exp(-t / 0.025)
    puff /= np.max(np.abs(puff))
    return thud + 0.3 * puff * raised_cos_attack(n, 0.003)


def sfx_fall():
    n = nsamp(1.1)
    t = taxis(n)
    vib = 1 + (0.004 + 0.02 * t) * np.sin(2 * np.pi * 6.0 * t)
    f = 1000.0 * 2 ** (-2.8 * (t / 1.0) ** 1.3) * vib                # slide-whistle fall
    ph = phase_from_freq(f)
    y = np.sin(ph) + 0.08 * np.sin(2 * ph)
    breath = bandpass(noise(n, 66), 1500.0, 5000.0)
    breath /= np.max(np.abs(breath))
    y += 0.04 * breath
    return y * env_asr(n, 0.02, 0.8, 0.28)


def _sfx_reverb(y, wet, seed, tail=0.6):
    ir = make_reverb_ir(tail, 0.12, seed, predelay=0.008)
    w = convolve(y, ir)[: len(y)]
    return y + wet * w * (np.max(np.abs(y)) / max(np.max(np.abs(w)), 1e-9))


def sfx_level_complete():
    total = nsamp(3.3)
    y = np.zeros(total)
    # quick pickup arpeggio, then IV - V - I "ta-da"
    for i, m in enumerate([72, 76, 79]):                      # C5 E5 G5
        place_mono(y, 0.1 * i, marimba(midi_hz(m), length=0.12), 0.6)
    place_mono(y, 0.30, marimba(midi_hz(84), length=0.28), 0.75)  # C6
    place_mono(y, 0.30, glock(midi_hz(84), length=0.28), 0.18)
    place_mono(y, 0.62, marimba(midi_hz(81), length=0.14), 0.7)   # A5 (over F)
    place_mono(y, 0.78, marimba(midi_hz(83), length=0.14), 0.7)   # B5 (over G)
    # final C major: marimba roll on C6/E6/G5 + glock sparkle + pad + bass
    for k in range(18):
        tk = 0.95 + 0.075 * k
        g = 0.55 * np.exp(-k / 9.0)
        for m in (79, 84, 88):
            place_mono(y, tk, marimba(midi_hz(m), length=0.2), g * (1.0 if k == 0 else 0.45))
    for i, m in enumerate([84, 88, 91, 96]):
        place_mono(y, 1.10 + 0.09 * i, glock(midi_hz(m), ring=1.0), 0.16)
    for t0, dur, notes, root in [(0.0, 0.6, (60, 64, 67), 48), (0.6, 0.18, (60, 65, 69), 41),
                                 (0.78, 0.17, (59, 62, 67), 43), (0.95, 1.7, (60, 64, 67, 72), 36)]:
        for m in notes:
            place_mono(y, t0, pad_voice(midi_hz(m), dur, 0.0), 0.10)
        place_mono(y, t0, bass(midi_hz(root), dur), 0.35)
    place_mono(y, 0.0, kick(), 0.35)
    place_mono(y, 0.95, kick(), 0.5)
    place_mono(y, 0.95, snare(), 0.18)
    for k in range(8):
        place_mono(y, 0.1 * k, shaker(700 + k), 0.12)
    y = _sfx_reverb(y, 0.35, 1201, tail=1.2)
    return y * env_asr(total, 0.0, 2.85, 0.45)


def sfx_game_over():
    total = nsamp(2.7)
    y = np.zeros(total)
    for i, m in enumerate([79, 76, 72, 69]):                  # G5 E5 C5 A4, gentle descent
        place_mono(y, 0.27 * i, marimba(midi_hz(m), length=0.25), 0.7)
        place_mono(y, 0.27 * i, kalimba(midi_hz(m - 12), length=0.25), 0.25)
    # soft plagal close: F major -> C major
    for t0, dur, notes, root in [(1.08, 0.55, (65, 69, 72), 41), (1.63, 0.7, (64, 67, 72), 36)]:
        for m in notes:
            place_mono(y, t0, marimba(midi_hz(m), ring=1.3), 0.32)
            place_mono(y, t0, pad_voice(midi_hz(m), dur, 0.0), 0.10)
        place_mono(y, t0, bass(midi_hz(root), dur), 0.35)
    t = taxis(total)
    y *= 1 - 0.08 * np.sin(2 * np.pi * 4.5 * t) * (t > 1.6)    # tiny "aww" wobble on the end
    y = _sfx_reverb(y, 0.3, 1301, tail=1.0)
    return y * env_asr(total, 0.0, 2.3, 0.4)


def sfx_ui_move():
    n = nsamp(0.07)
    t = taxis(n)
    f = 1350 + 150 * np.exp(-t / 0.01)
    ph = phase_from_freq(f)
    y = np.sin(ph) + 0.15 * np.sin(3.93 * ph) * np.exp(-t / 0.005)
    return y * env_ad(n, 0.001, 0.016)


def sfx_ui_select():
    total = nsamp(0.32)
    y = np.zeros(total)
    place_mono(y, 0.0, marimba(midi_hz(88), length=0.06), 0.6)    # E6
    place_mono(y, 0.06, marimba(midi_hz(93), ring=0.6), 0.8)      # A6
    place_mono(y, 0.06, glock(midi_hz(93), ring=0.25), 0.2)
    t = taxis(total)
    chirp = np.sin(phase_from_freq(900 + 900 * (1 - np.exp(-t / 0.03)))) * env_ad(total, 0.003, 0.03)
    y += 0.2 * chirp
    return _sfx_reverb(y, 0.15, 1401, tail=0.4)


SFX = {
    "jump": sfx_jump,
    "coin": sfx_coin,
    "stomp": sfx_stomp,
    "hurt": sfx_hurt,
    "checkpoint": sfx_checkpoint,
    "land": sfx_land,
    "fall": sfx_fall,
    "level_complete": sfx_level_complete,
    "game_over": sfx_game_over,
    "ui_move": sfx_ui_move,
    "ui_select": sfx_ui_select,
}


# ----------------------------------------------------------------------------------------
# Music
# ----------------------------------------------------------------------------------------

def pan_gains(pan):
    """Equal-power pan, pan in [-1, 1]."""
    a = (pan + 1.0) * np.pi / 4.0
    return np.cos(a), np.sin(a)


class Loop:
    """Stereo stems rendered onto a timeline of exactly `length` samples plus a tail region.

    Tails that run past the loop end are folded back onto the start, and every effect after
    that (filters, delay, reverb) is circular, so the last sample flows into the first.
    """

    TAIL = nsamp(4.0)

    def __init__(self, bpm, bars, beats_per_bar=4):
        spb = SR * 60.0 / bpm
        assert abs(spb - round(spb)) < 1e-9, "BPM must give a whole number of samples per beat"
        self.spb = int(round(spb))
        self.beats_per_bar = beats_per_bar
        self.length = self.spb * beats_per_bar * bars
        self.stems: dict[str, np.ndarray] = {}

    def stem(self, name):
        if name not in self.stems:
            self.stems[name] = np.zeros((2, self.length + self.TAIL))
        return self.stems[name]

    def sample_at(self, bar, beat):
        return int(round((bar * self.beats_per_bar + beat) * self.spb))

    def add(self, name, bar, beat, sig, gain=1.0, pan=0.0):
        buf = self.stem(name)
        i = self.sample_at(bar, beat)
        sig = sig[: buf.shape[1] - i]
        gl, gr = pan_gains(pan)
        buf[0, i:i + len(sig)] += gain * gl * sig
        buf[1, i:i + len(sig)] += gain * gr * sig

    def add_stereo(self, name, bar, beat, sl, sr_, gain=1.0):
        buf = self.stem(name)
        i = self.sample_at(bar, beat)
        n = min(len(sl), buf.shape[1] - i)
        buf[0, i:i + n] += gain * sl[:n]
        buf[1, i:i + n] += gain * sr_[:n]

    def folded(self, name):
        buf = self.stems[name]
        out = buf[:, : self.length].copy()
        out[:, : self.TAIL] += buf[:, self.length:]
        return out


def circular_reverb(x, ir_l, ir_r):
    n = x.shape[1]
    mono = x.mean(axis=0)
    spec = np.fft.rfft(mono, n)
    out = np.empty_like(x)
    for ch, ir in enumerate((ir_l, ir_r)):
        out[ch] = np.fft.irfft(spec * np.fft.rfft(ir, n), n)
    return out


def circular_pingpong(x, delay_samples, feedback=0.32, taps=4, lp_hz=3500.0):
    mono = lowpass(x.mean(axis=0), lp_hz, circular=True)
    out = np.zeros_like(x)
    g = 1.0
    for k in range(1, taps + 1):
        g *= feedback
        ch = 1 if k % 2 else 0
        out[ch] += g * np.roll(mono, k * delay_samples)
    return out


def render_loop(loop: Loop, sends: dict, reverb_seed: int, reverb_tau: float, wet: float,
                delay_stems=(), delay_beats=0.75, master_lp=13000.0):
    names = list(loop.stems)
    dry = {k: loop.folded(k) for k in names}
    mix = sum(dry.values())
    # delay (lead) - circular
    for k in delay_stems:
        if k in dry:
            mix = mix + 0.55 * circular_pingpong(dry[k], int(round(delay_beats * loop.spb)))
    # reverb bus - circular
    bus = sum(sends.get(k, 0.0) * dry[k] for k in names)
    ir_l = make_reverb_ir(2.0, reverb_tau, reverb_seed)
    ir_r = make_reverb_ir(2.0, reverb_tau, reverb_seed + 10)
    mix = mix + wet * circular_reverb(bus, ir_l, ir_r)
    mix = lowpass(mix, master_lp, order=2, circular=True)
    mix -= mix.mean(axis=1, keepdims=True)
    # gentle memoryless soft-saturation to tame drum peaks (keeps loop continuity)
    mix /= np.max(np.abs(mix))
    mix = np.tanh(1.2 * mix) / np.tanh(1.2)
    mix *= db_to_lin(MUSIC_PRE_ENCODE_PEAK_DB) / np.max(np.abs(mix))
    stem_rms = {k: float(np.sqrt(np.mean(v ** 2))) for k, v in dry.items()}
    return mix, stem_rms


# Chords: bass root (MIDI), pad voicing (MIDI)
CHORDS = {
    "F": (41, (57, 60, 65)),
    "Am": (45, (57, 60, 64)),
    "Bb": (46, (58, 62, 65)),
    "C": (48, (55, 60, 64)),
    "Dm": (50, (57, 62, 65)),
    "Gm": (43, (55, 58, 62)),
    "C7": (48, (55, 58, 60, 64)),
    "Fmaj7": (41, (57, 60, 64, 65)),
    "Dm7": (50, (57, 60, 62, 65)),
    "Bbmaj7": (46, (57, 58, 62, 65)),
    "Am7": (45, (55, 57, 60, 64)),
    "Gm7": (43, (53, 55, 58, 62)),
}

# Meadow lead melody. Each bar: list of (beat, length_in_beats, midi). F major.
HOOK = [
    [(0, .5, 72), (.5, .5, 69), (1, .5, 72), (1.5, 1, 77), (2.5, .5, 76), (3, .5, 77), (3.5, .5, 79)],  # F
    [(0, 1, 81), (1, .5, 79), (1.5, .5, 76), (2, 1.5, 72)],                                            # Am
    [(0, .5, 74), (.5, .5, 77), (1, .5, 74), (1.5, 1, 70), (2.5, .5, 72), (3, .5, 74), (3.5, .5, 77)],  # Bb
    [(0, 1, 76), (1, .5, 74), (1.5, .5, 72), (2, 1, 67), (3, .5, 69), (3.5, .5, 70)],                  # C
    [(0, .5, 72), (.5, .5, 69), (1, .5, 72), (1.5, 1, 77), (2.5, .5, 76), (3, .5, 77), (3.5, .5, 79)],  # F
    [(0, 1, 81), (1, .5, 84), (1.5, .5, 81), (2, 1, 79), (3, 1, 76)],                                  # Am
    [(0, .5, 77), (.5, .5, 74), (1, .5, 77), (1.5, 1, 82), (2.5, .5, 81), (3, .5, 79), (3.5, .5, 77)],  # Bb
    [(0, 1.5, 79), (1.5, .5, 76), (2, 2, 72)],                                                          # C
]
HOOK_END_RUN = [(0, .5, 72), (.5, .5, 74), (1, .5, 76), (1.5, .5, 79), (2, 1, 84), (3, .5, 81), (3.5, .5, 77)]
B_MELODY = [
    [(0, 1.5, 74), (1.5, .5, 72), (2, 1, 70), (3, 1, 74)],                                              # Bb
    [(0, 1.5, 76), (1.5, .5, 74), (2, 1, 72), (3, 1, 76)],                                              # C
    [(0, 1, 76), (1, 1, 81), (2, 1, 79), (3, 1, 76)],                                                   # Am
    [(0, 2, 77), (2, 1, 74), (3, 1, 69)],                                                               # Dm
    [(0, .5, 70), (.5, .5, 74), (1, 1, 77), (2, .5, 74), (2.5, .5, 77), (3, 1, 82)],                    # Bb
    [(0, 1, 81), (1, 1, 79), (2, 1, 76), (3, 1, 72)],                                                   # C
    [(0, 1, 74), (1, .5, 70), (1.5, .5, 74), (2, 2, 79)],                                               # Gm
    [(0, .5, 76), (.5, .5, 77), (1, .5, 79), (1.5, .5, 82), (2, .5, 81), (2.5, .5, 79), (3, .5, 76), (3.5, .5, 72)],  # C7
]
A_CHORDS = ["F", "Am", "Bb", "C", "F", "Am", "Bb", "C"]
B_CHORDS = ["Bb", "C", "Am", "Dm", "Bb", "C", "Gm", "C7"]
# A' countermelody (glockenspiel): two chord tones per bar, high
A_COUNTER = [(81, 84), (84, 88), (86, 89), (88, 91), (81, 84), (88, 84), (86, 82), (84, 79)]


def compose_meadow():
    lp = Loop(bpm=120, bars=24)
    rng = np.random.default_rng(2024)

    def vel(base=1.0, spread=0.08):
        return base * (1.0 + spread * (rng.random() - 0.5) * 2)

    sections = [("A", 0), ("A2", 8), ("B", 16)]
    for sec, start in sections:
        chords = B_CHORDS if sec == "B" else A_CHORDS
        for b in range(8):
            bar = start + b
            name = chords[b]
            root, voicing = CHORDS[name]

            # --- lead
            if sec == "B":
                for beat, dur, m in B_MELODY[b]:
                    lp.add("lead", bar, beat, kalimba(midi_hz(m), length=dur * 0.5 + 0.15), 0.55 * vel(), pan=0.1)
            else:
                notes = HOOK_END_RUN if (sec == "A2" and b == 7) else HOOK[b]
                for beat, dur, m in notes:
                    acc = 1.08 if beat in (0, 2) else 1.0
                    lp.add("lead", bar, beat, marimba(midi_hz(m), length=dur * 0.5 + 0.12),
                           0.6 * acc * vel(), pan=-0.12)

            # --- countermelody / chord plucks in A'
            if sec == "A2":
                if b < 7:
                    for k, m in enumerate(A_COUNTER[b]):
                        lp.add("glock", bar, 2 * k, glock(midi_hz(m), length=1.2), 0.16 * vel(), pan=0.45)
                for beat in (1.5, 3.5):
                    for m in voicing:
                        lp.add("pluck", bar, beat, marimba(midi_hz(m + 12), length=0.12, bright=0.6),
                               0.17 * vel(), pan=0.3)
            if sec == "B" and b % 2 == 1:
                lp.add("glock", bar, 3.5, glock(midi_hz(voicing[-1] + 24), length=0.6), 0.10, pan=0.5)

            # --- pad (detuned voices split L/R for width)
            pad_gain = 0.085 if sec == "B" else 0.065
            for m in voicing:
                f = midi_hz(m)
                dur = 4 * lp.spb / SR
                lp.add_stereo("pad", bar, 0, pad_voice(f, dur - 0.05, -6), pad_voice(f, dur - 0.05, +6), pad_gain)

            # --- bass
            r = midi_hz(root)
            if sec == "B":
                if name == "C7":
                    pattern = [(0, 1, 0), (1, 1, 4), (2, 1, 7), (3, 1, 10)]
                else:
                    pattern = [(0, 1.5, 0), (1.5, .5, 7), (2, 1.5, 0), (3.5, .5, 12)]
            else:
                pattern = [(0, 1.5, 0), (1.5, .5, 7), (2, 1, 12), (3, 1, 7)]
            for beat, dur, iv in pattern:
                lp.add("bass", bar, beat, bass(r * 2 ** (iv / 12), dur * 0.5 - 0.04), 0.5 * vel(1, 0.05))

            # --- drums
            K, S = kick(), snare()
            kicks = [0, 2] if sec != "A2" else [0, 1.5, 2]
            if sec == "B":
                kicks = [0, 2.5]
            for beat in kicks:
                lp.add("kick", bar, beat, K, 0.8)
            if sec == "A" and b < 4:
                snares = [3] if b % 2 == 1 else []
            elif sec == "B":
                snares = [2]
            else:
                snares = [1, 3]
            for beat in snares:
                lp.add("snare", bar, beat, S, 0.75, pan=0.05)
            step = 0.25 if sec == "A2" else 0.5
            for k in range(int(4 / step)):
                beat = k * step
                g = 0.40 if (beat % 1) == 0.5 else (0.24 if (beat % 0.5) == 0.25 else 0.30)
                lp.add("shaker", bar, beat, shaker(800 + (k % 4)), g * vel(1, 0.15), pan=0.35)
            if sec == "B":
                for beat in (1.5, 3.5):
                    lp.add("wood", bar, beat, woodblock(1250 if beat == 1.5 else 950), 0.28, pan=-0.4)
            if sec == "B" and b == 7:  # fill back into the A section
                for k, beat in enumerate([3, 3.25, 3.5, 3.75]):
                    lp.add("snare", bar, beat, S, 0.25 + 0.12 * k, pan=0.05)

    sends = {"lead": 0.30, "glock": 0.45, "pluck": 0.35, "pad": 0.35, "snare": 0.25,
             "shaker": 0.10, "wood": 0.25, "bass": 0.03, "kick": 0.0}
    return render_loop(lp, sends, reverb_seed=5150, reverb_tau=0.24, wet=0.22,
                       delay_stems=("lead",), delay_beats=0.75)


MENU_CHORDS = ["Fmaj7", "Dm7", "Bbmaj7", "C", "Fmaj7", "Am7", "Bbmaj7", "Gm7"]
MENU_MELODY = [
    [(0, 1.5, 81), (1.5, .5, 79), (2, 1, 77), (3, 1, 72)],
    [(0, 1, 74), (1, 1, 77), (2, 2, 81)],
    [(0, 1.5, 79), (1.5, .5, 77), (2, 1, 74), (3, 1, 70)],
    [(0, 2, 72), (2, 1, 76), (3, 1, 79)],
    [(0, 1.5, 81), (1.5, .5, 84), (2, 1, 81), (3, 1, 77)],
    [(0, 1, 76), (1, 1, 79), (2, 2, 84)],
    [(0, 1.5, 86), (1.5, .5, 84), (2, 1, 81), (3, 1, 77)],
    [(0, 1, 79), (1, 1, 77), (2, 1, 76), (3, 1, 72)],
]


def compose_menu():
    lp = Loop(bpm=90, bars=8)
    rng = np.random.default_rng(909)
    for bar in range(8):
        name = MENU_CHORDS[bar]
        root, voicing = CHORDS[name]
        for beat, dur, m in MENU_MELODY[bar]:
            g = 0.5 * (1 + 0.06 * (rng.random() - 0.5))
            lp.add("lead", bar, beat, kalimba(midi_hz(m), length=dur * 0.667 + 0.2, ring=1.2), g, pan=-0.1)
        # soft arpeggiated accompaniment in 8ths (kalimba, low)
        arp = list(voicing) + [voicing[1] + 12]
        for k in range(8):
            m = arp[[0, 1, 2, 3, 2, 1, 2, 3][k] % len(arp)]
            if name == "Gm7" and k >= 4:   # last half-bar walks to C for the turnaround
                m = [60, 64, 67, 64][k - 4]
            lp.add("arp", bar, 0.5 * k, kalimba(midi_hz(m), length=0.3, ring=0.7),
                   0.16 * (1.1 if k % 2 == 0 else 0.9), pan=0.35)
        # pad; the last bar splits Gm7 -> C so the turnaround resolves cleanly into Fmaj7
        halves = [(0, 4, voicing)] if name != "Gm7" else [(0, 2, voicing), (2, 2, CHORDS["C7"][1])]
        for beat0, beats, notes in halves:
            dur = beats * lp.spb / SR - 0.05
            for m in notes:
                lp.add_stereo("pad", bar, beat0, pad_voice(midi_hz(m), dur, -7), pad_voice(midi_hz(m), dur, +7), 0.08)
        r = midi_hz(root)
        if name == "Gm7":
            pattern = [(0, 2, 0), (2, 2, 5)]          # G -> C turnaround
        else:
            pattern = [(0, 2.5, 0), (2.5, 1.5, 7)]
        for beat, dur, iv in pattern:
            lp.add("bass", bar, beat, bass(r * 2 ** (iv / 12), dur * 0.667 - 0.05), 0.42)
        lp.add("kick", bar, 0, kick(), 0.5)
        for k in range(4):
            lp.add("shaker", bar, k + 0.5, shaker(820 + k), 0.22, pan=0.4)
        if bar % 2 == 1:
            lp.add("glock", bar, 2, glock(midi_hz(voicing[-1] + 24), length=1.5), 0.08, pan=0.5)
    sends = {"lead": 0.40, "arp": 0.35, "pad": 0.45, "glock": 0.5, "shaker": 0.15, "bass": 0.03}
    return render_loop(lp, sends, reverb_seed=6160, reverb_tau=0.32, wet=0.28,
                       delay_stems=("lead",), delay_beats=0.75, master_lp=11000.0)


# ----------------------------------------------------------------------------------------
# Output
# ----------------------------------------------------------------------------------------

def to_pcm16(x: np.ndarray) -> bytes:
    """x: (n,) mono or (2, n) stereo float in [-1, 1] -> interleaved little-endian int16."""
    if x.ndim == 2:
        x = x.T.reshape(-1)
    q = np.clip(np.round(x * 32767.0), -32767, 32767).astype("<i2")
    return q.tobytes()


def write_wav(path: Path, x: np.ndarray, channels: int):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(to_pcm16(x))


def finish_sfx(name: str, y: np.ndarray) -> np.ndarray:
    y = edge_fades(y, 0.002, 0.012 if len(y) < nsamp(0.3) else 0.03)
    return y * (db_to_lin(SFX_PEAK_DB[name]) / np.max(np.abs(y)))


def encode_ogg(wav: Path, ogg: Path):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        sys.exit("ffmpeg not found on PATH (needed for OGG Vorbis encoding)")
    subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(wav), "-map_metadata", "-1",
                    "-c:a", "libvorbis", "-q:a", "5", "-fflags", "+bitexact", "-flags:a", "+bitexact",
                    str(ogg)], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    for name, fn in SFX.items():
        y = finish_sfx(name, fn())
        write_wav(out / f"{name}.wav", y, 1)
        print(f"  {name}.wav  {len(y) / SR:.2f}s")

    with tempfile.TemporaryDirectory() as td:
        for name, fn in [("music_meadow", compose_meadow), ("music_menu", compose_menu)]:
            mix, stems = fn()
            wav = Path(td) / f"{name}.wav"
            write_wav(wav, mix, 2)
            encode_ogg(wav, out / f"{name}.ogg")
            rms = ", ".join(f"{k}={20 * np.log10(v + 1e-12):.1f}" for k, v in stems.items())
            print(f"  {name}.ogg  {mix.shape[1] / SR:.2f}s  (stem RMS dB: {rms})")


if __name__ == "__main__":
    main()
