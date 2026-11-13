/** Shared fakes for game tests: scripted input, recording services. */
import type {
  ButtonId,
  GameServices,
  HighScoreStore,
  InputFrame,
  MusicTrack,
  SfxSpec,
  SoundOutput,
} from '../../../src/games/GameInterface';
import { FrameBuffer } from '../../../src/games/common/FrameBuffer';
import { createRng } from '../../../src/games/common/Rng';

/** InputFrame driven by a script: call `next(...held)` once per tick to set the held buttons. */
export class ScriptedInput implements InputFrame {
  private current = new Set<ButtonId>();
  private previous = new Set<ButtonId>();

  next(...held: ButtonId[]): this {
    this.previous = this.current;
    this.current = new Set(held);
    return this;
  }

  isDown(button: ButtonId): boolean {
    return this.current.has(button);
  }

  wasPressed(button: ButtonId): boolean {
    return this.current.has(button) && !this.previous.has(button);
  }

  wasReleased(button: ButtonId): boolean {
    return !this.current.has(button) && this.previous.has(button);
  }
}

export class RecordingSound implements SoundOutput {
  readonly effects: SfxSpec[] = [];
  readonly musicLog: string[] = [];
  playing: string | null = null;

  sfx(spec: SfxSpec): void {
    this.effects.push(spec);
  }

  playMusic(track: MusicTrack): void {
    if (this.playing === track.id) return;
    this.playing = track.id;
    this.musicLog.push(track.id);
  }

  stopMusic(): void {
    this.playing = null;
    this.musicLog.push('stop');
  }
}

export class MemoryHighScores implements HighScoreStore {
  readonly scores = new Map<string, number>();

  get(gameId: string): number {
    return this.scores.get(gameId) ?? 0;
  }

  submit(gameId: string, score: number): boolean {
    if (score > this.get(gameId)) {
      this.scores.set(gameId, score);
      return true;
    }
    return false;
  }
}

export interface FakeServices extends GameServices {
  readonly sound: RecordingSound;
  readonly highScores: MemoryHighScores;
}

export function createServices(seed = 1234): FakeServices {
  return { sound: new RecordingSound(), highScores: new MemoryHighScores(), random: createRng(seed) };
}

/** Number of distinct shades present in the frame. */
export function distinctShades(fb: FrameBuffer): number {
  const seen = new Set<number>();
  for (const v of fb.data) seen.add(v);
  return seen.size;
}

/** Count of pixels of a shade inside a rectangle. */
export function countShade(fb: FrameBuffer, shade: number, x = 0, y = 0, w = fb.width, h = fb.height): number {
  let n = 0;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (fb.getPixel(xx, yy) === shade) n++;
  return n;
}

/** Ticks `game` with no buttons held `count` times. */
export function idle(game: { tick(input: InputFrame): void }, input: ScriptedInput, count: number): void {
  for (let i = 0; i < count; i++) game.tick(input.next());
}

/** Presses and releases one button (two ticks). */
export function tap(game: { tick(input: InputFrame): void }, input: ScriptedInput, button: ButtonId): void {
  game.tick(input.next(button));
  game.tick(input.next());
}
