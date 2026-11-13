import { describe, expect, it } from 'vitest';
import { FrameBuffer } from '../../../src/games/common/FrameBuffer';
import { CARTRIDGES, getCartridge } from '../../../src/games/registry';
import { createServices, distinctShades, idle, ScriptedInput, tap } from './helpers';

describe('registry', () => {
  it('lists the three cartridges in shelf order', () => {
    expect(CARTRIDGES.map((c) => c.id)).toEqual(['pixel-blocks', 'pixel-snake', 'retro-racer']);
    expect(getCartridge('pixel-snake')?.title).toBe('Pixel Snake');
    expect(getCartridge('nope')).toBeUndefined();
  });

  it.each(CARTRIDGES.map((c) => [c.id, c] as const))('%s has complete metadata and label art', (_id, cart) => {
    expect(cart.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(cart.title.length).toBeGreaterThan(0);
    expect(cart.description.length).toBeGreaterThan(20);
    expect(cart.controls.length).toBeGreaterThanOrEqual(3);
    const { art } = cart.label;
    expect(art.length).toBeGreaterThanOrEqual(8);
    const width = art[0]!.length;
    expect(width).toBeGreaterThanOrEqual(16);
    expect(width).toBeLessThanOrEqual(32);
    for (const row of art) {
      expect(row.length).toBe(width);
      expect(row).toMatch(/^[.0-3]+$/);
    }
    for (const colour of [cart.label.background, cart.label.accent, cart.label.text]) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('labels are visually distinct', () => {
    const arts = CARTRIDGES.map((c) => c.label.art.join('\n'));
    expect(new Set(arts).size).toBe(3);
  });

  it.each(CARTRIDGES.map((c) => [c.id, c] as const))(
    '%s starts on its title screen and survives power-off',
    (_id, cart) => {
      const services = createServices();
      const game = cart.create(services);
      const input = new ScriptedInput();
      const fb = new FrameBuffer();
      idle(game, input, 5);
      game.render(fb);
      expect(distinctShades(fb)).toBeGreaterThan(1);
      expect(services.sound.playing).not.toBeNull();
      tap(game, input, 'start');
      game.render(fb);
      game.dispose();
      expect(services.sound.playing).toBeNull();
    },
  );
});
