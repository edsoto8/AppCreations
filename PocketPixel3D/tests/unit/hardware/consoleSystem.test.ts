import { describe, expect, it } from 'vitest';
import { BOOT_TIMING } from '../../../src/display/BootSequence';
import { getCartridge } from '../../../src/games/registry';
import { ConsoleSystem } from '../../../src/hardware/ConsoleSystem';
import { createRng } from '../../../src/games/common/Rng';
import { MemoryHighScores, RecordingSound } from '../games/helpers';

function makeConsole(): { machine: ConsoleSystem; sound: RecordingSound } {
  const sound = new RecordingSound();
  const machine = new ConsoleSystem({ speaker: sound, highScores: new MemoryHighScores(), random: createRng(7) });
  return { machine, sound };
}

const blocks = getCartridge('pixel-blocks')!;
const snake = getCartridge('pixel-snake')!;

function nonZero(data: Uint8Array): number {
  let n = 0;
  for (const v of data) if (v !== 0) n++;
  return n;
}

describe('ConsoleSystem', () => {
  it('starts switched off and runs nothing', () => {
    const { machine } = makeConsole();
    expect(machine.mode).toBe('off');
    expect(machine.update(1)).toBe(0);
    expect(machine.ticks).toBe(0);
  });

  it('boots, chimes once, then hands over to the cartridge title screen', () => {
    const { machine, sound } = makeConsole();
    machine.insertCartridge(blocks);
    machine.setPower(true);
    expect(machine.mode).toBe('boot');
    for (let i = 0; i < BOOT_TIMING.dropEnd + 2; i++) machine.step();
    expect(sound.effects.length).toBeGreaterThanOrEqual(2); // two-voice chime
    const chimeCount = sound.effects.length;
    expect(nonZero(machine.framebuffer.data)).toBeGreaterThan(50); // logo visible
    for (let i = 0; i < BOOT_TIMING.fadeEnd; i++) machine.step();
    expect(machine.mode).toBe('running');
    expect(sound.effects.length).toBeGreaterThanOrEqual(chimeCount);
    expect(nonZero(machine.framebuffer.data)).toBeGreaterThan(50); // title screen drawn
  });

  it('waits forever on the boot screen without a cartridge', () => {
    const { machine, sound } = makeConsole();
    machine.setPower(true);
    for (let i = 0; i < 2000; i++) machine.step();
    expect(machine.mode).toBe('boot');
    expect(sound.effects).toHaveLength(0); // no chime without a game
  });

  it('locks the cartridge while powered and frees it when switched off', () => {
    const { machine } = makeConsole();
    const rejected: string[] = [];
    machine.events.on('rejected', (m) => rejected.push(m));
    machine.insertCartridge(blocks);
    machine.setPower(true);
    expect(machine.ejectCartridge().ok).toBe(false);
    expect(machine.insertCartridge(snake).ok).toBe(false);
    expect(rejected).toHaveLength(2);
    expect(machine.cartridge?.id).toBe('pixel-blocks');
    machine.setPower(false);
    expect(machine.ejectCartridge().ok).toBe(true);
    expect(machine.insertCartridge(snake).ok).toBe(true);
    expect(machine.cartridge?.id).toBe('pixel-snake');
  });

  it('refuses a second cartridge while one is inserted', () => {
    const { machine } = makeConsole();
    machine.insertCartridge(blocks);
    expect(machine.insertCartridge(snake).ok).toBe(false);
  });

  it('stops music and the game when powered off, and restarts from boot', () => {
    const { machine, sound } = makeConsole();
    machine.insertCartridge(blocks);
    machine.setPower(true);
    for (let i = 0; i < BOOT_TIMING.fadeEnd + 10; i++) machine.step();
    expect(machine.mode).toBe('running');
    machine.setPower(false);
    expect(sound.playing).toBeNull();
    expect(machine.mode).toBe('off');
    machine.setPower(true);
    expect(machine.mode).toBe('boot');
    expect(machine.ticks).toBe(0);
  });

  it('gates game sound while off', () => {
    const { machine, sound } = makeConsole();
    machine.insertCartridge(blocks);
    machine.setPower(true);
    for (let i = 0; i < BOOT_TIMING.fadeEnd + 5; i++) machine.step();
    machine.setPower(false);
    const before = sound.effects.length;
    machine.step();
    expect(sound.effects.length).toBe(before);
  });

  it('runs whole fixed ticks from real time and caps catch-up', () => {
    const { machine } = makeConsole();
    machine.insertCartridge(blocks);
    machine.setPower(true);
    expect(machine.update(1 / 60)).toBe(1);
    expect(machine.update(0.5 / 60)).toBe(0);
    expect(machine.update(0.5 / 60)).toBe(1);
    expect(machine.update(10)).toBeLessThanOrEqual(8);
  });

  it('START from the keyboard path reaches the game through the button system', () => {
    const { machine } = makeConsole();
    machine.insertCartridge(blocks);
    machine.setPower(true);
    for (let i = 0; i < BOOT_TIMING.fadeEnd + 30; i++) machine.step();
    const title = machine.framebuffer.data.slice();
    machine.buttons.press('start', 'keyboard');
    machine.step();
    machine.buttons.release('start', 'keyboard');
    for (let i = 0; i < 30; i++) machine.step();
    expect(Buffer.from(machine.framebuffer.data).equals(Buffer.from(title))).toBe(false);
  });

  it('battery cover state emits events', () => {
    const { machine } = makeConsole();
    const seen: boolean[] = [];
    machine.events.on('batteryCover', (o) => seen.push(o));
    machine.setBatteryCover(true);
    machine.setBatteryCover(true);
    machine.setBatteryCover(false);
    expect(seen).toEqual([true, false]);
  });
});
