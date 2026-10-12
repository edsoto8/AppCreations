import { describe, expect, it } from 'vitest';
import { OccIndex, type OccRec } from '../../src/render/terrain/occluders';

function rec(x0: number, y0: number, x1: number, y1: number, z: number): OccRec {
  return { tex: null as never, x: (x0 + x1) / 2, y: y1, z, sx: 1, sy: 1, tint: 0xffffff, x0, y0, x1, y1, stamp: 0, occ: null };
}

describe('OccIndex', () => {
  it('returns records that overlap the box and sort after z', () => {
    const idx = new OccIndex();
    const near = rec(100, 100, 140, 160, 10);
    const behind = rec(100, 100, 140, 160, 3);
    const far = rec(1000, 1000, 1040, 1060, 10);
    for (const r of [near, behind, far]) idx.add(r);
    const out: OccRec[] = [];
    idx.query(90, 90, 150, 170, 5, 1, out);
    expect(out).toEqual([near]);
  });

  it('reports a record spanning several grid cells once per stamp', () => {
    const idx = new OccIndex();
    const wide = rec(0, 0, 600, 400, 9);
    idx.add(wide);
    const out: OccRec[] = [];
    idx.query(-10, -10, 700, 500, 1, 7, out);
    idx.query(-10, -10, 700, 500, 1, 7, out);
    expect(out).toHaveLength(1);
    idx.query(-10, -10, 700, 500, 1, 8, out);
    expect(out).toHaveLength(2);
  });

  it('handles negative world coordinates', () => {
    const idx = new OccIndex();
    const r = rec(-500, -300, -420, -200, 4);
    idx.add(r);
    const out: OccRec[] = [];
    idx.query(-450, -250, -440, -240, 0, 1, out);
    expect(out).toEqual([r]);
    const none: OccRec[] = [];
    idx.query(-100, -100, 100, 100, 0, 2, none);
    expect(none).toHaveLength(0);
  });
});
