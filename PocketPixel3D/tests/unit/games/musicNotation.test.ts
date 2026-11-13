import { describe, expect, it } from 'vitest';
import type { MusicTrack } from '../../../src/games/GameInterface';
import { channelLengths, midiToFrequency, noteNameToMidi, parseTrack } from '../../../src/games/common/MusicNotation';
import { BLOCKS_THEME, BLOCKS_TITLE_THEME } from '../../../src/games/PixelBlocksAudio';
import { SNAKE_THEME, SNAKE_TITLE_THEME } from '../../../src/games/PixelSnakeAudio';
import { RACER_THEME, RACER_TITLE_THEME } from '../../../src/games/RetroRacerAudio';

function track(notes: string, wave: MusicTrack['channels'][number]['wave'] = 'pulse50', tempo = 120): MusicTrack {
  return { id: 't', tempo, loop: true, channels: [{ wave, volume: 0.5, notes }] };
}

describe('MusicNotation', () => {
  it('maps note names to MIDI', () => {
    expect(noteNameToMidi('C4')).toBe(60);
    expect(noteNameToMidi('A4')).toBe(69);
    expect(noteNameToMidi('C#4')).toBe(61);
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('Bb3')).toBe(58);
    expect(noteNameToMidi('B5')).toBe(83);
  });

  it('converts MIDI to frequency', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(81)).toBeCloseTo(880, 6);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
  });

  it('parses notes, rests and bar lines into absolute steps', () => {
    const parsed = parseTrack(track('C5:2 -:2 | E5:1 G5:3', 'pulse25', 150));
    expect(parsed.stepSeconds).toBeCloseTo(60 / 150 / 4, 10);
    expect(parsed.totalSteps).toBe(8);
    expect(parsed.loop).toBe(true);
    expect(parsed.channels[0]?.notes).toEqual([
      { step: 0, length: 2, midi: 72 },
      { step: 4, length: 1, midi: 76 },
      { step: 5, length: 3, midi: 79 },
    ]);
  });

  it('maps drum tokens on noise channels and uses the longest channel', () => {
    const parsed = parseTrack({
      id: 'drums',
      tempo: 100,
      loop: false,
      channels: [
        { wave: 'noise', volume: 0.3, notes: 'k:1 s:1 h:2 x:1 -:3' },
        { wave: 'triangle', volume: 0.3, notes: 'C3:4' },
      ],
    });
    expect(parsed.channels[0]?.notes.map((n) => n.midi)).toEqual([36, 38, 42, 0]);
    expect(parsed.totalSteps).toBe(8);
  });

  it('throws clear errors on bad tokens', () => {
    expect(() => parseTrack(track('C5'))).toThrow(/bad token "C5"/);
    expect(() => parseTrack(track('H5:2'))).toThrow(/bad note name/);
    expect(() => parseTrack(track('C5:0'))).toThrow(/bad length/);
    expect(() => parseTrack(track('C5:1.5'))).toThrow(/bad length/);
    expect(() => parseTrack(track('C5:x'))).toThrow(/bad length/);
    expect(() => parseTrack(track('k:1', 'pulse50'))).toThrow(/only allowed on a noise channel/);
    expect(() => parseTrack(track('C5:1:2'))).toThrow(/bad token/);
    expect(() => parseTrack(track('C5:1', 'pulse50', 0))).toThrow(/tempo/);
  });

  it.each([BLOCKS_THEME, BLOCKS_TITLE_THEME, SNAKE_THEME, SNAKE_TITLE_THEME, RACER_THEME, RACER_TITLE_THEME])(
    'game track $id parses with aligned channels',
    (t) => {
      const parsed = parseTrack(t);
      const lengths = channelLengths(t);
      expect(new Set(lengths).size).toBe(1);
      expect(parsed.totalSteps % 16).toBe(0);
      expect(t.channels.length).toBeGreaterThanOrEqual(2);
      expect(t.channels.length).toBeLessThanOrEqual(4);
    },
  );

  it('main themes are 8-16 bars long', () => {
    for (const t of [BLOCKS_THEME, SNAKE_THEME, RACER_THEME]) {
      const bars = parseTrack(t).totalSteps / 16;
      expect(bars).toBeGreaterThanOrEqual(8);
      expect(bars).toBeLessThanOrEqual(16);
    }
  });
});
