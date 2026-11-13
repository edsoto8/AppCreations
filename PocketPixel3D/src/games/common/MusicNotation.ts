/**
 * Parser for the {@link MusicTrack} note notation documented in GameInterface.ts.
 *
 * Tokens (whitespace separated): `C5:2` note, `Bb4:1` flat, `F#3:4` sharp, `-:4` rest,
 * `x:1` / `k:1` / `s:1` / `h:1` drum hits (noise channels only), `|` bar line (ignored).
 */
import type { MusicTrack, ParsedChannel, ParsedNote, ParsedTrack } from '../GameInterface';

/** MIDI note numbers for the drum tokens. */
export const DRUM_MIDI: Readonly<Record<'x' | 'k' | 's' | 'h', number>> = { x: 0, k: 36, s: 38, h: 42 };

const NOTE_SEMITONES: Readonly<Record<string, number>> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

const NOTE_PATTERN = /^([A-G](?:#|b)?)(-?\d+)$/;
const LENGTH_PATTERN = /^[1-9]\d*$/;

/** Frequency in Hz of a MIDI note number (A4 = 69 = 440 Hz). */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI note number of a note name like "C4" (60) or "Bb3"; throws on anything else. */
export function noteNameToMidi(name: string): number {
  const match = NOTE_PATTERN.exec(name);
  const semitone = match ? NOTE_SEMITONES[match[1] ?? ''] : undefined;
  if (!match || semitone === undefined) throw new Error(`Invalid note name "${name}"`);
  const midi = (Number(match[2]) + 1) * 12 + semitone;
  if (midi < 0 || midi > 127) throw new Error(`Note "${name}" is outside the MIDI range 0-127`);
  return midi;
}

/** Parses one channel's notes; returns the notes and the channel's length in steps. */
function parseChannelNotes(
  notes: string,
  isNoise: boolean,
  where: string,
): { notes: ParsedNote[]; length: number } {
  const out: ParsedNote[] = [];
  let step = 0;
  const tokens = notes.split(/\s+/);
  for (const token of tokens) {
    if (token === '' || token === '|') continue;
    const colon = token.indexOf(':');
    if (colon <= 0 || colon !== token.lastIndexOf(':')) {
      throw new Error(`${where}: bad token "${token}" (expected NAME:LENGTH, e.g. "C5:2" or "-:4")`);
    }
    const name = token.slice(0, colon);
    const lengthText = token.slice(colon + 1);
    if (!LENGTH_PATTERN.test(lengthText)) {
      throw new Error(`${where}: bad length in token "${token}" (must be a positive whole number of steps)`);
    }
    const length = Number(lengthText);
    if (name === '-') {
      step += length;
      continue;
    }
    let midi: number;
    if (name === 'x' || name === 'k' || name === 's' || name === 'h') {
      if (!isNoise) {
        throw new Error(`${where}: drum token "${token}" is only allowed on a noise channel`);
      }
      midi = DRUM_MIDI[name];
    } else {
      try {
        midi = noteNameToMidi(name);
      } catch {
        throw new Error(`${where}: bad note name in token "${token}"`);
      }
    }
    out.push({ step, length, midi });
    step += length;
  }
  return { notes: out, length: step };
}

/**
 * Converts a track to absolute step positions and MIDI numbers.
 * `stepSeconds` = 60 / tempo / 4 (a sixteenth note); `totalSteps` = the longest channel.
 * Throws an Error naming the track, channel and token on malformed input.
 */
export function parseTrack(track: MusicTrack): ParsedTrack {
  if (!(track.tempo > 0) || !Number.isFinite(track.tempo)) {
    throw new Error(`Track "${track.id}": tempo must be a positive number, got ${track.tempo}`);
  }
  let totalSteps = 0;
  const channels: ParsedChannel[] = track.channels.map((channel, index) => {
    const where = `Track "${track.id}" channel ${index}`;
    const parsed = parseChannelNotes(channel.notes, channel.wave === 'noise', where);
    if (parsed.length > totalSteps) totalSteps = parsed.length;
    return { wave: channel.wave, volume: channel.volume, notes: parsed.notes };
  });
  return {
    id: track.id,
    stepSeconds: 60 / track.tempo / 4,
    totalSteps,
    loop: track.loop,
    channels,
  };
}

/** Length in steps of every channel (handy for checking that loops stay aligned). */
export function channelLengths(track: MusicTrack): number[] {
  return track.channels.map((channel, index) =>
    parseChannelNotes(channel.notes, channel.wave === 'noise', `Track "${track.id}" channel ${index}`).length,
  );
}
