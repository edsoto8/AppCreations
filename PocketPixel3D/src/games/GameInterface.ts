/**
 * The contract between the console "hardware" and cartridge games.
 *
 * Game code must stay pure: no Three.js, no DOM, no Web Audio. Games read buttons through
 * {@link InputFrame}, draw into a {@link FrameBuffer} of shade indices, and describe sound as data
 * ({@link SfxSpec}, {@link MusicTrack}) that the audio layer synthesises.
 */
import type { FrameBuffer } from './common/FrameBuffer';

export const SCREEN_WIDTH = 160;
export const SCREEN_HEIGHT = 144;
/** Games are ticked at exactly this rate by a fixed-timestep loop. */
export const TICK_RATE = 60;

/** Shade index: 0 = lightest (LCD background), 3 = darkest. */
export type Shade = 0 | 1 | 2 | 3;

export type ButtonId = 'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'start' | 'select';
export const BUTTON_IDS: readonly ButtonId[] = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];

/** Snapshot of the buttons for one tick. Edges are relative to the previous tick. */
export interface InputFrame {
  isDown(button: ButtonId): boolean;
  /** True only on the tick the button went down. */
  wasPressed(button: ButtonId): boolean;
  /** True only on the tick the button went up. */
  wasReleased(button: ButtonId): boolean;
}

/** Oscillator types available to games. `pulse12/25/50` are square waves with that duty cycle. */
export type Waveform = 'pulse12' | 'pulse25' | 'pulse50' | 'triangle' | 'sawtooth' | 'noise';

/**
 * A synthesised sound effect.
 * - `freq` as a single number plays one tone; as an array it plays an arpeggio, each entry lasting
 *   `stepDuration` seconds (0 in the array = silent step).
 * - `freqEnd` slides the pitch exponentially from the (first) freq to this value over `duration`.
 * - For `noise`, `freq` sets the noise colour (higher = brighter hiss).
 */
export interface SfxSpec {
  readonly wave: Waveform;
  /** Total length in seconds. */
  readonly duration: number;
  readonly freq: number | readonly number[];
  readonly freqEnd?: number;
  readonly stepDuration?: number;
  /** 0..1, defaults to 0.5. */
  readonly volume?: number;
  /** Seconds of linear fade-out at the end, defaults to min(0.05, duration / 2). */
  readonly release?: number;
}

/**
 * Chiptune music as data.
 *
 * `notes` notation (whitespace separated tokens):
 *   `C5:2`  note C in octave 5 lasting 2 steps. Names: C C# D D# E F F# G G# A A# B (also Db Eb Gb Ab Bb).
 *   `-:4`   rest for 4 steps.
 *   `x:1`   (noise channel only) a drum hit; pitch ignored. `k:1` kick (low noise), `s:1` snare (mid),
 *           `h:1` hi-hat (high). The length still advances time.
 *   `|`     bar line, ignored (readability only).
 * One step = a sixteenth note at `tempo` BPM, i.e. 60 / tempo / 4 seconds.
 * Every channel should add up to the same total steps so loops stay aligned.
 */
export interface MusicChannel {
  readonly wave: Waveform;
  /** 0..1 */
  readonly volume: number;
  readonly notes: string;
}

export interface MusicTrack {
  readonly id: string;
  readonly tempo: number;
  readonly loop: boolean;
  readonly channels: readonly MusicChannel[];
}

/** Parsed form of a {@link MusicTrack}, produced by `parseTrack` in `common/MusicNotation.ts`. */
export interface ParsedNote {
  /** Start, in steps from the start of the track. */
  readonly step: number;
  readonly length: number;
  /** MIDI note number, or for noise channels: 0 = generic hit, 36 = kick, 38 = snare, 42 = hi-hat. */
  readonly midi: number;
}

export interface ParsedChannel {
  readonly wave: Waveform;
  readonly volume: number;
  readonly notes: readonly ParsedNote[];
}

export interface ParsedTrack {
  readonly id: string;
  readonly stepSeconds: number;
  readonly totalSteps: number;
  readonly loop: boolean;
  readonly channels: readonly ParsedChannel[];
}

export interface SoundOutput {
  sfx(spec: SfxSpec): void;
  /** Starts a track (replacing any current one). Passing the track that is already playing is a no-op. */
  playMusic(track: MusicTrack): void;
  stopMusic(): void;
}

export interface HighScoreStore {
  get(gameId: string): number;
  /** Records a score; returns true when it beats the stored high score. */
  submit(gameId: string, score: number): boolean;
}

export interface GameServices {
  readonly sound: SoundOutput;
  readonly highScores: HighScoreStore;
  /** Uniform random in [0, 1). Injected so tests can be deterministic. */
  readonly random: () => number;
}

export interface Game {
  /** Advance exactly one 1/60 s tick. */
  tick(input: InputFrame): void;
  /** Draw the current state. Must fully redraw the frame (do not rely on previous contents). */
  render(fb: FrameBuffer): void;
  /** Release anything held (e.g. stop music). Called when power goes off. */
  dispose(): void;
}

/** Art for the physical cartridge label (drawn by the 3D layer onto a canvas texture). */
export interface CartridgeLabel {
  /** CSS colours. */
  readonly background: string;
  readonly accent: string;
  readonly text: string;
  /** Short line under the title, e.g. "PUZZLE". */
  readonly tagline: string;
  /**
   * Pixel art rows. Characters: '.' transparent, '0'-'3' shades of the label's own palette
   * (0 = background, 1 = accent, 2 = text, 3 = black). Every row the same length, ideally 16-32 wide.
   */
  readonly art: readonly string[];
}

export interface CartridgeDefinition {
  /** Stable id, also the high-score key. Lowercase kebab-case. */
  readonly id: string;
  readonly title: string;
  /** One or two sentences for the cartridge library UI. */
  readonly description: string;
  /** Human-readable control summary for the help UI, e.g. [["A", "Rotate"], ...]. */
  readonly controls: readonly (readonly [string, string])[];
  readonly label: CartridgeLabel;
  /** Create a fresh game, starting at its own title screen. */
  create(services: GameServices): Game;
}
