import { describe, expect, it } from 'vitest';
import { buildFoxMesh } from '../src/fox/FoxBuilder';

describe('buildFoxMesh', () => {
  const mesh = buildFoxMesh({ cell: 0.006 });

  it('produces a non-trivial triangle mesh', () => {
    expect(mesh.positions.length / 3).toBeGreaterThan(5000);
    expect(mesh.indices.length % 3).toBe(0);
    for (const i of mesh.indices) expect(i).toBeLessThan(mesh.positions.length / 3);
  });

  it('is closed: every edge is shared by exactly two triangles', () => {
    const edges = new Map<string, number>();
    const idx = mesh.indices;
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + ((e + 1) % 3)];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    let bad = 0;
    for (const c of edges.values()) if (c !== 2) bad++;
    // Surface Nets can create a handful of non-manifold edges at pinch points.
    expect(bad / edges.size).toBeLessThan(0.002);
  });

  it('has normalised skin weights', () => {
    for (let v = 0; v < mesh.skinWeight.length; v += 4) {
      const s = mesh.skinWeight[v] + mesh.skinWeight[v + 1] + mesh.skinWeight[v + 2] + mesh.skinWeight[v + 3];
      expect(Math.abs(s - 1)).toBeLessThan(1e-4);
    }
  });

  it('places the eyes symmetrically on the face', () => {
    const { L, R } = mesh.eyes;
    expect(L.center[0]).toBeGreaterThan(0.01);
    expect(R.center[0]).toBeCloseTo(-L.center[0], 6);
    expect(L.center[2]).toBeGreaterThan(0.3);
  });
});
