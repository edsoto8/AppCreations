# Audio

All Brightmeadow sound effects and music are **original procedural synthesis**. They are made by
this repository's own script, `assets/audio/synth_audio.py`, using numpy: additive and FM oscillators
with envelopes, FFT-filtered noise for percussion, and a numpy convolution reverb and ping-pong delay.
No samples, recordings, sound fonts or downloaded assets are used anywhere. The generated files are
part of this project and carry **the same licence as the project**.

The file names, formats and purposes follow `docs/ASSET_CONTRACT.md`, section "Audio".

## Regenerating

```bash
scripts/generate_audio.sh
```

This sources `scripts/env.sh`, picks a Python that has numpy (`$AUDIO_PY`, then `$BLENDER_PY`, then
`python3`), runs the generator, and then runs the checker. It needs `ffmpeg` (with libvorbis) and
`ffprobe` on `PATH`. The output is deterministic: every random source has a fixed seed, and the OGG
encode uses ffmpeg's bit-exact flags. Re-running gives byte-identical files with the same numpy and
ffmpeg builds (checked with sha256 on numpy 1.26.4 and ffmpeg 6.1.1). The two scripts can also be run
directly:

```bash
python assets/audio/synth_audio.py [--out DIR]   # write game/assets/audio/*
python assets/audio/check_audio.py [--dir DIR]   # verify; exit code 1 on failure
```

`check_audio.py` checks that every contracted file exists, plus the format, duration, peak level, DC
offset and click-free start and end of each file. For the OGGs it runs `ffprobe`, decodes the whole
stream with `ffmpeg`, checks the exact sample count (whole bars), and compares the loop seam with the
rest of the file: the sample jump, the slope change and the 50 ms RMS step against every internal bar
line.

## Formats and levels

- **SFX:** mono, 44.1 kHz, 16-bit PCM WAV. Each has a 2 ms fade-in and a 12–30 ms fade-out, so it
  starts and ends on zero. Peaks are normalised to -1 dBFS, except two deliberately quieter sounds
  that play very often: `land` at -9 dBFS and `ui_move` at -4 dBFS.
- **Music:** stereo, 44.1 kHz, OGG Vorbis q5 (about 125–135 kb/s), with peaks around -3 dBFS. Each
  loop is exactly a whole number of bars long. Notes and echoes that ring past the loop end are
  folded back onto the start. The delay, reverb and filters are all circular, so the last sample
  leads straight into the first.

### Godot import note

The OGGs loop seamlessly only when looping is enabled. In Godot 4 that means the `loop` import
option on `AudioStreamOggVorbis` (`loop=true`, `loop_offset=0` in the `.import` file, or the Import
dock), or `stream.loop = true` in code. The optional beat metadata is: meadow `bpm=120`,
`beat_count=96`, `bar_beats=4`; menu `bpm=90`, `beat_count=32`, `bar_beats=4`. The WAV SFX are
one-shots and need no loop.

## Sound effects

| File | Length | Description |
|---|---|---|
| `jump.wav` | 0.28 s | Quick upward pitch sweep (about 330 to 700 Hz) with a soft 12 ms attack. A touch of FM brightness at the start gives a chiptune flavour, and a quiet marimba ping (C6) sits on top. |
| `coin.wav` | 0.62 s | Bright two-note chime, B5 then E6, using harmonic bell partials. A detuned twin gives a 4 Hz shimmer, with a faint high sparkle on top. |
| `stomp.wav` | 0.36 s | Squishy boing: a low pitch-dropping thump, a rising wobbly "boing" tone (21 Hz vibrato) and a short band-passed noise squish. |
| `hurt.wav` | 0.50 s | Descending wobble: a soft triangle-like tone falling about 1.1 octaves, with 11 Hz vibrato and tremolo. |
| `checkpoint.wav` | 1.05 s | Rising G-major arpeggio (G5 B5 D6 G6) on marimba and glockenspiel. The top note rings with a shimmer. |
| `land.wav` | 0.18 s | Quiet soft thud: a low sine pitch drop (145 to 55 Hz) plus a low-passed noise puff. Peak -9 dBFS. |
| `fall.wav` | 1.10 s | Slide-whistle fall from about 1 kHz down to about 140 Hz, with vibrato that widens as it goes and a little breath noise. |
| `level_complete.wav` | 3.30 s | Happy fanfare in C: a marimba pickup (C5 E5 G5 C6), then A5 over F and B5 over G, landing on a C-major marimba roll with a glockenspiel sparkle, pad, bass, soft kick and shaker, and light reverb. |
| `game_over.wav` | 2.70 s | Gentle descending jingle: G5 E5 C5 A4 on marimba doubled by a low kalimba, then a soft plagal close (F to C), a slight "aww" wobble and light reverb. |
| `ui_move.wav` | 0.07 s | Tiny wooden tick/blip at about 1.4 kHz, with a 16 ms decay. Peak -4 dBFS. |
| `ui_select.wav` | 0.32 s | Confirm chirp: two quick marimba notes, E6 then A6, with a glockenspiel touch and a soft rising chirp. |

## Music

### `music_meadow.ogg`: level loop (48.0 s, 120 BPM, 4/4, F major, 24 bars)

| Section | Bars | Chords (one per bar) | Arrangement |
|---|---|---|---|
| A | 1–8 | F, Am, Bb, C, F, Am, Bb, C | Marimba lead plays the main hook. Warm bass (root, fifth, octave, fifth), detuned pad, kick on 1 and 3, 8th-note shaker. A light snare plays in bars 1–4, then a full backbeat from bar 5. |
| A' | 9–16 | same as A | Same hook, plus a glockenspiel countermelody, offbeat marimba chord plucks, a 16th-note shaker and an extra kick on the "and" of 2. Ends in a rising run (C D E G C6 A F) into B. |
| B | 17–24 | Bb, C, Am, Dm, Bb, C, Gm, C7 | Contrast section with a lyrical kalimba lead, half-time snare and woodblock offbeats. The C7 bar has a walking bass and a soft snare fill leading back to A. |

The hook (bar 1 over F) is C5 A4 C5 F5 E5 F5 G5, answered over Am by A5 G5 E5 C5. The lead has a
dotted-8th ping-pong delay. The pad voices are split left and right for width, the shaker and
glockenspiel sit right, and the woodblock sits left. A shared stereo reverb with decorrelated
left and right impulse responses goes over the whole mix.

### `music_menu.ogg`: menu loop (21.33 s, 90 BPM, 4/4, F major, 8 bars)

The chords are Fmaj7, Dm7, Bbmaj7, C, Fmaj7, Am7, Bbmaj7, then Gm7 moving to C. It is a gentler
arrangement: a slow kalimba melody over a soft 8th-note kalimba arpeggio, a wide pad and a soft
bass, with a kick only on beat 1, offbeat shaker and a glockenspiel bell every other bar. It has
more reverb than the level loop and a darker master low-pass.
