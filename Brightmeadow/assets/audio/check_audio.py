#!/usr/bin/env python3
"""Verify Brightmeadow's generated audio against docs/ASSET_CONTRACT.md ("Audio").

Checks every contracted file exists; WAVs are mono 44.1 kHz 16-bit with the expected length,
peak level and click-free start/end; OGGs decode (ffprobe + ffmpeg), are stereo 44.1 kHz
Vorbis with the right duration, do not clip, and loop seamlessly (sample jump, slope and
short-term RMS across the end->start seam compared with the rest of the file).

Usage: python assets/audio/check_audio.py [--dir DIR]   (exit code 1 on any failure)
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44100
APP_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = APP_ROOT / "game" / "assets" / "audio"

# name: (min_s, max_s, expected peak dBFS)
SFX = {
    "jump": (0.1, 0.6, -1.0),
    "coin": (0.2, 1.0, -1.0),
    "stomp": (0.1, 0.6, -1.0),
    "hurt": (0.2, 0.8, -1.0),
    "checkpoint": (0.4, 1.5, -1.0),
    "land": (0.05, 0.4, -9.0),
    "fall": (0.5, 1.6, -1.0),
    "level_complete": (2.0, 4.0, -1.0),
    "game_over": (2.0, 3.0, -1.0),
    "ui_move": (0.02, 0.2, -4.0),
    "ui_select": (0.05, 0.5, -1.0),
}
MUSIC = {"music_meadow": (32.0, 64.0), "music_menu": (16.0, 32.0)}
MUSIC_PEAK_DB = -3.0
MAX_MUSIC_BYTES = 1_500_000

failures: list[str] = []


def check(cond: bool, msg: str):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        failures.append(msg)


def dbfs(x: float) -> float:
    return 20 * np.log10(max(x, 1e-12))


def read_wav(path: Path):
    with wave.open(str(path), "rb") as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        data = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768.0
    return ch, sw, sr, data.reshape(-1, ch).T


def ffprobe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json",
                          str(path)], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def decode(path: Path, channels: int) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-acodec", "pcm_f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64).reshape(-1, channels).T


def seam_report(x: np.ndarray, bar_len: int):
    """Compare the end->start seam with every other sample boundary / bar line in the file."""
    wrapped = np.concatenate([x, x[:, :1]], axis=1)
    d1 = np.abs(np.diff(wrapped, axis=1))               # the seam is the last element
    seam_jump = d1[:, -1].max()
    p999 = np.percentile(d1[:, :-1], 99.9)
    # second difference (slope change): clicks show up here strongly
    w2 = np.concatenate([x[:, -2:], x, x[:, :2]], axis=1)
    d2 = np.abs(np.diff(w2, n=2, axis=1))
    seam_d2 = d2[:, 0:4].max()                           # second differences touching the seam
    p999_d2 = np.percentile(d2, 99.9)
    # short-term RMS 50 ms either side of the seam, versus the same measurement at every
    # internal bar line (a downbeat naturally gets louder; the seam must behave like a bar line)
    win = int(0.05 * SR)

    def step(b):
        pre = x[:, b - win:b] if b >= win else np.concatenate([x[:, b - win:], x[:, :b]], axis=1)
        post = x[:, b:b + win]
        return dbfs(np.sqrt(np.mean(pre ** 2))), dbfs(np.sqrt(np.mean(post ** 2)))

    rms_end, rms_start = step(0)
    bars = x.shape[1] // bar_len
    internal = [abs(a - b) for a, b in (step(k * bar_len) for k in range(1, bars))]
    overall = dbfs(np.sqrt(np.mean(x ** 2)))
    return dict(seam_jump=seam_jump, p999=p999, seam_d2=seam_d2, p999_d2=p999_d2,
                rms_end=rms_end, rms_start=rms_start, rms_step=abs(rms_end - rms_start),
                bar_step_max=max(internal), bar_step_med=float(np.median(internal)), overall=overall)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    d = ap.parse_args().dir
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found on PATH")

    print(f"Checking {d}")
    for name, (lo, hi, peak_db) in SFX.items():
        p = d / f"{name}.wav"
        print(f"{p.name}")
        if not p.exists():
            check(False, f"{p.name} missing")
            continue
        ch, sw, sr, x = read_wav(p)
        dur = x.shape[1] / sr
        pk = dbfs(np.max(np.abs(x)))
        check(ch == 1 and sw == 2 and sr == SR, f"format mono/16-bit/44100 (got {ch}ch/{8 * sw}-bit/{sr})")
        check(lo <= dur <= hi, f"duration {dur:.3f}s in [{lo}, {hi}]")
        check(abs(pk - peak_db) < 0.3 and pk < -0.5, f"peak {pk:.2f} dBFS (target {peak_db}, no clipping)")
        check(abs(x[0, 0]) < 1e-3 and abs(x[0, -1]) < 1e-3,
              f"click-free edges (first {x[0, 0]:+.5f}, last {x[0, -1]:+.5f})")
        check(abs(np.mean(x)) < 0.01, f"DC offset {np.mean(x):+.5f}")

    for name, (lo, hi) in MUSIC.items():
        p = d / f"{name}.ogg"
        print(f"{p.name}")
        if not p.exists():
            check(False, f"{p.name} missing")
            continue
        info = ffprobe(p)
        st = info["streams"][0]
        size = p.stat().st_size
        check(st["codec_name"] == "vorbis" and int(st["sample_rate"]) == SR and int(st["channels"]) == 2,
              f"ffprobe: codec={st['codec_name']} sr={st['sample_rate']} ch={st['channels']} "
              f"duration={float(info['format']['duration']):.3f}s bitrate={int(info['format']['bit_rate']) // 1000} kb/s")
        x = decode(p, 2)
        dur = x.shape[1] / SR
        check(lo <= dur <= hi, f"decoded duration {dur:.4f}s ({x.shape[1]} samples) in [{lo}, {hi}]")
        # whole bars: 24 bars @120 BPM, 8 bars @90 BPM
        exact = {"music_meadow": 24 * 4 * 22050, "music_menu": 8 * 4 * 29400}[name]
        check(x.shape[1] == exact, f"decoded length is exactly {exact} samples (whole bars, no padding)")
        pk = dbfs(np.max(np.abs(x)))
        check(-4.0 < pk < -1.0, f"decoded peak {pk:.2f} dBFS (target about {MUSIC_PEAK_DB})")
        width = np.sqrt(np.mean((x[0] - x[1]) ** 2) / np.mean((x[0] + x[1]) ** 2))
        check(width > 0.05, f"stereo side/mid ratio {width:.3f} (has stereo width)")
        check(size < MAX_MUSIC_BYTES, f"size {size / 1e6:.2f} MB < {MAX_MUSIC_BYTES / 1e6:.1f} MB")
        s = seam_report(x, exact // ({"music_meadow": 24, "music_menu": 8}[name]))
        check(s["seam_jump"] <= s["p999"],
              f"loop seam sample jump {s['seam_jump']:.5f} <= 99.9th pct of all steps {s['p999']:.5f}")
        check(s["seam_d2"] <= s["p999_d2"],
              f"loop seam slope change {s['seam_d2']:.5f} <= 99.9th pct {s['p999_d2']:.5f}")
        check(s["rms_step"] <= s["bar_step_max"] + 0.5,
              f"loop seam RMS {s['rms_end']:.1f} dB -> {s['rms_start']:.1f} dB, step {s['rms_step']:.2f} dB "
              f"(internal bar lines: median {s['bar_step_med']:.2f}, max {s['bar_step_max']:.2f} dB)")
        check(s["rms_end"] > s["overall"] - 12.0,
              f"no gap before the seam: last 50 ms at {s['rms_end']:.1f} dB vs file RMS {s['overall']:.1f} dB")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        sys.exit(1)
    print("All audio checks passed.")


if __name__ == "__main__":
    main()
