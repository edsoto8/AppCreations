import type { V3 } from './primitives';

export interface SurfaceNetsOptions {
  min: V3;
  max: V3;
  /** Voxel edge length. */
  cell: number;
  /** Coarse block size in voxels used to skip empty space. */
  block?: number;
  onProgress?: (fraction: number) => void;
}

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/**
 * Naive Surface Nets over a signed distance function.
 *
 * A coarse pass evaluates block corners and only blocks that can contain the surface are
 * sampled at full resolution, so the cost scales with surface area rather than volume.
 * The result is a closed, quad-dominant mesh (split into triangles) with one vertex per
 * surface-crossing voxel.
 */
export function surfaceNets(sdf: (x: number, y: number, z: number) => number, opts: SurfaceNetsOptions): RawMesh {
  const { min, max, cell } = opts;
  const B = opts.block ?? 4;
  const nx = Math.ceil((max[0] - min[0]) / cell) + 1;
  const ny = Math.ceil((max[1] - min[1]) / cell) + 1;
  const nz = Math.ceil((max[2] - min[2]) / cell) + 1;
  const sxy = nx * ny;
  const values = new Float32Array(nx * ny * nz);
  const exact = new Uint8Array(nx * ny * nz);

  // --- Pass 1: coarse corners -------------------------------------------------------------
  const bx = Math.ceil((nx - 1) / B), by = Math.ceil((ny - 1) / B), bz = Math.ceil((nz - 1) / B);
  const cnx = bx + 1, cny = by + 1, cnz = bz + 1;
  const coarse = new Float32Array(cnx * cny * cnz);
  const nodeX = (ci: number) => Math.min(ci * B, nx - 1);
  const nodeY = (cj: number) => Math.min(cj * B, ny - 1);
  const nodeZ = (ck: number) => Math.min(ck * B, nz - 1);
  for (let ck = 0; ck < cnz; ck++) {
    for (let cj = 0; cj < cny; cj++) {
      for (let ci = 0; ci < cnx; ci++) {
        coarse[ci + cnx * (cj + cny * ck)] = sdf(
          min[0] + nodeX(ci) * cell,
          min[1] + nodeY(cj) * cell,
          min[2] + nodeZ(ck) * cell,
        );
      }
    }
  }

  // --- Pass 2: refine blocks near the surface ----------------------------------------------
  const blockDiag = B * cell * Math.sqrt(3);
  const threshold = blockDiag * 1.5;
  for (let k = 0; k < bz; k++) {
    opts.onProgress?.((k / bz) * 0.8);
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        let minAbs = Infinity;
        let sample = 0;
        for (let c = 0; c < 8; c++) {
          const v = coarse[i + (c & 1) + cnx * (j + ((c >> 1) & 1) + cny * (k + ((c >> 2) & 1)))];
          if (Math.abs(v) < minAbs) minAbs = Math.abs(v);
          sample = v;
        }
        const i0 = i * B, i1 = Math.min(i0 + B, nx - 1);
        const j0 = j * B, j1 = Math.min(j0 + B, ny - 1);
        const k0 = k * B, k1 = Math.min(k0 + B, nz - 1);
        const near = minAbs < threshold;
        for (let kk = k0; kk <= k1; kk++) {
          const z = min[2] + kk * cell;
          for (let jj = j0; jj <= j1; jj++) {
            const y = min[1] + jj * cell;
            let idx = i0 + nx * jj + sxy * kk;
            for (let ii = i0; ii <= i1; ii++, idx++) {
              if (exact[idx]) continue;
              if (near) {
                values[idx] = sdf(min[0] + ii * cell, y, z);
                exact[idx] = 1;
              } else {
                // Far from the surface every node shares the corners' sign.
                values[idx] = sample;
              }
            }
          }
        }
      }
    }
  }

  // --- Pass 3: one vertex per crossing cell ---------------------------------------------------
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cellIndex = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  // Corner offsets in the value grid for the 8 corners of a cell.
  const cornerOff = [0, 1, nx, nx + 1, sxy, sxy + 1, sxy + nx, sxy + nx + 1];
  // 12 cell edges as corner pairs.
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float64Array(8);
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const base = i + nx * j + sxy * k;
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = values[base + cornerOff[c]];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (const [a, b] of edges) {
          const va = cv[a], vb = cv[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          ax += (a & 1) + ((b & 1) - (a & 1)) * t;
          ay += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          az += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          n++;
        }
        cellIndex[i + cx * (j + cy * k)] = pos.length / 3;
        pos.push(min[0] + (i + ax / n) * cell, min[1] + (j + ay / n) * cell, min[2] + (k + az / n) * cell);
      }
    }
  }
  opts.onProgress?.(0.9);

  // --- Pass 4: quads around every sign-changing grid edge -------------------------------------
  const idx: number[] = [];
  const cellAt = (i: number, j: number, k: number) => cellIndex[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
      const t = b;
      b = d;
      d = t;
    }
    // Split along the shorter diagonal for better-shaped triangles.
    const dac = dist2(pos, a, c), dbd = dist2(pos, b, d);
    if (dac <= dbd) idx.push(a, b, c, a, c, d);
    else idx.push(a, b, d, b, c, d);
  };
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        if (cellAt(i, j, k) < 0) continue;
        const base = i + nx * j + sxy * k;
        const inside0 = values[base] < 0;
        // Edge along +x from the cell's min corner.
        if (j > 0 && k > 0 && inside0 !== values[base + 1] < 0) {
          quad(cellAt(i, j, k), cellAt(i, j - 1, k), cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), !inside0);
        }
        // Edge along +y.
        if (i > 0 && k > 0 && inside0 !== values[base + nx] < 0) {
          quad(cellAt(i, j, k), cellAt(i, j, k - 1), cellAt(i - 1, j, k - 1), cellAt(i - 1, j, k), !inside0);
        }
        // Edge along +z.
        if (i > 0 && j > 0 && inside0 !== values[base + sxy] < 0) {
          quad(cellAt(i, j, k), cellAt(i - 1, j, k), cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), !inside0);
        }
      }
    }
  }
  opts.onProgress?.(1);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function dist2(p: number[], a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3], dy = p[a * 3 + 1] - p[b * 3 + 1], dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}
