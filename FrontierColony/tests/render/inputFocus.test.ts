import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isGameFocus } from '../../src/render/input';

class FakeElement {}

describe('isGameFocus', () => {
  const body = new FakeElement();
  const root = new FakeElement();
  const canvas = new FakeElement();

  beforeEach(() => {
    vi.stubGlobal('HTMLElement', FakeElement);
    vi.stubGlobal('document', { body, documentElement: root });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lets the camera use keys when the canvas, body or page has focus', () => {
    expect(isGameFocus(canvas as never, canvas as never)).toBe(true);
    expect(isGameFocus(body as never, canvas as never)).toBe(true);
    expect(isGameFocus(root as never, canvas as never)).toBe(true);
    expect(isGameFocus(null, canvas as never)).toBe(true);
  });

  it('leaves the keys to any other focused element (buttons, radio groups, panels)', () => {
    expect(isGameFocus(new FakeElement() as never, canvas as never)).toBe(false);
  });
});
