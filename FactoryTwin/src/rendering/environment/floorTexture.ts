import type { CanvasTexture } from 'three';
import type { FactoryLayout } from '../../logistics/layout';
import { FONT, canvasTexture, seeded } from '../models/textures';

/** Ground area painted by the floor texture (building slab + outside apron). */
export const GROUND = { x0: -66, z0: -38, x1: 66, z1: 38 } as const;
const PX_W = 4096;

export const AISLE_HALF_WIDTH = 1.3;

/**
 * Paints the whole ground (concrete slab, zones, aisle lines, walkways, dock hatching, apron
 * with truck bays) into ONE CanvasTexture so all floor markings cost a single draw call.
 * Canvas top = north (z0), left = west (x0).
 */
export function paintFloor(layout: FactoryLayout): CanvasTexture {
  const W = GROUND.x1 - GROUND.x0;
  const H = GROUND.z1 - GROUND.z0;
  const ppm = PX_W / W;
  const PX_H = Math.round(H * ppm);
  const X = (x: number) => (x - GROUND.x0) * ppm;
  const Z = (z: number) => (z - GROUND.z0) * ppm;
  const S = (m: number) => m * ppm;
  const b = layout.bounds;

  return canvasTexture(PX_W, PX_H, (ctx) => {
    const rnd = seeded(42);
    // --- apron (asphalt) ------------------------------------------------------------------
    ctx.fillStyle = '#45484b';
    ctx.fillRect(0, 0, PX_W, PX_H);
    for (let i = 0; i < 30000; i++) {
      const v = 50 + Math.floor(rnd() * 50);
      ctx.fillStyle = `rgba(${v},${v},${v + 3},0.5)`;
      ctx.fillRect(rnd() * PX_W, rnd() * PX_H, 2, 2);
    }
    // --- concrete slab --------------------------------------------------------------------
    ctx.fillStyle = '#b9bdbf';
    ctx.fillRect(X(b.x0), Z(b.z0), S(b.x1 - b.x0), S(b.z1 - b.z0));
    ctx.save();
    ctx.beginPath();
    ctx.rect(X(b.x0), Z(b.z0), S(b.x1 - b.x0), S(b.z1 - b.z0));
    ctx.clip();
    for (let i = 0; i < 1400; i++) {
      const x = X(b.x0) + rnd() * S(b.x1 - b.x0);
      const y = Z(b.z0) + rnd() * S(b.z1 - b.z0);
      const r = S(0.8 + rnd() * 3.5);
      const light = rnd() > 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, light ? 'rgba(255,255,255,0.06)' : 'rgba(90,84,76,0.035)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 60000; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(X(b.x0) + rnd() * S(b.x1 - b.x0), Z(b.z0) + rnd() * S(b.z1 - b.z0), 1.5, 1.5);
    }
    // saw-cut expansion joints every 6 m
    ctx.strokeStyle = 'rgba(60,60,60,0.22)';
    ctx.lineWidth = 1.5;
    for (let x = b.x0 + 6; x < b.x1; x += 6) line(ctx, X(x), Z(b.z0), X(x), Z(b.z1));
    for (let z = b.z0 + 6; z < b.z1; z += 6) line(ctx, X(b.x0), Z(z), X(b.x1), Z(z));
    ctx.restore();

    // --- zones ------------------------------------------------------------------------------
    for (const zn of layout.zones) {
      const r = zn.rect;
      ctx.fillStyle = hexA(zn.color, 0.12);
      ctx.fillRect(X(r.x0), Z(r.z0), S(r.x1 - r.x0), S(r.z1 - r.z0));
      ctx.strokeStyle = hexA(zn.color, 0.9);
      ctx.lineWidth = S(0.1);
      ctx.setLineDash([]);
      ctx.strokeRect(X(r.x0) + S(0.05), Z(r.z0) + S(0.05), S(r.x1 - r.x0 - 0.1), S(r.z1 - r.z0 - 0.1));
    }

    // --- aisles: yellow edge lines (draw wide yellow, then the band on top) ---------------------
    ctx.lineCap = 'square';
    ctx.strokeStyle = '#f2c200';
    ctx.lineWidth = S(AISLE_HALF_WIDTH * 2 + 0.24);
    for (const a of layout.aisles) polyline(ctx, a.map(([x, z]) => [X(x), Z(z)]));
    ctx.strokeStyle = '#b0b4b6';
    ctx.lineWidth = S(AISLE_HALF_WIDTH * 2);
    for (const a of layout.aisles) polyline(ctx, a.map(([x, z]) => [X(x), Z(z)]));
    // dashed white centre lines
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = S(0.08);
    ctx.setLineDash([S(1.2), S(1.0)]);
    ctx.lineCap = 'butt';
    for (const a of layout.aisles) polyline(ctx, a.map(([x, z]) => [X(x), Z(z)]));
    ctx.setLineDash([]);

    // --- zone labels (after aisles so they stay readable) -------------------------------------
    for (const zn of layout.zones) {
      const r = zn.rect;
      const w = S(r.x1 - r.x0 - 0.8);
      let size = S(0.95);
      ctx.font = `bold ${size}px ${FONT}`;
      while (ctx.measureText(zn.label).width > w && size > S(0.35)) {
        size -= 2;
        ctx.font = `bold ${size}px ${FONT}`;
      }
      ctx.fillStyle = hexA(zn.color, 0.85);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(zn.label, X(r.x0) + S(0.4), Z(r.z0) + S(0.35));
    }

    // --- pedestrian walkways (green with white edges) + zebra crossings ------------------------
    const walk = (x0: number, z0: number, x1: number, z1: number) => {
      ctx.fillStyle = 'rgba(46,158,68,0.55)';
      ctx.fillRect(X(x0), Z(z0), S(x1 - x0), S(z1 - z0));
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = S(0.1);
      ctx.strokeRect(X(x0), Z(z0), S(x1 - x0), S(z1 - z0));
    };
    const zebra = (x0: number, z0: number, x1: number, z1: number, vertical: boolean) => {
      ctx.fillStyle = '#f4f4f4';
      const n = Math.floor((vertical ? z1 - z0 : x1 - x0) / 0.5);
      for (let i = 0; i < n; i += 2) {
        if (vertical) ctx.fillRect(X(x0), Z(z0 + i * 0.5), S(x1 - x0), S(0.5));
        else ctx.fillRect(X(x0 + i * 0.5), Z(z0), S(0.5), S(z1 - z0));
      }
    };
    const ent = layout.entrance.pos;
    walk(ent[0] - 0.9, 22 + AISLE_HALF_WIDTH + 0.15, ent[0] + 0.9, b.z1);
    zebra(ent[0] - 0.9, 22 - AISLE_HALF_WIDTH, ent[0] + 0.9, 22 + AISLE_HALF_WIDTH, true);
    const cr = layout.controlRoom;
    walk(-17, cr.center[1] + cr.size[1] / 2 + 0.05, 8, -22 - AISLE_HALF_WIDTH - 0.15);

    // --- dock hatching inside the doors -------------------------------------------------------
    const hatch = (x0: number, z0: number, x1: number, z1: number) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(x0), Z(z0), S(x1 - x0), S(z1 - z0));
      ctx.clip();
      ctx.fillStyle = '#f2c200';
      ctx.fillRect(X(x0), Z(z0), S(x1 - x0), S(z1 - z0));
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = S(0.25);
      const span = S(Math.max(x1 - x0, z1 - z0) + (z1 - z0));
      for (let d = -span; d < span; d += S(0.7)) line(ctx, X(x0) + d, Z(z0), X(x0) + d + S(z1 - z0), Z(z1));
      ctx.restore();
    };
    for (const bay of layout.receivingBays) hatch(b.x0, bay.door[1] - 1.9, b.x0 + 2.2, bay.door[1] + 1.9);
    for (const bay of layout.shippingBays) hatch(b.x1 - 2.2, bay.door[1] - 1.9, b.x1, bay.door[1] + 1.9);

    // --- robot keep-out circles ------------------------------------------------------------------
    ctx.lineWidth = S(0.09);
    ctx.setLineDash([S(0.35), S(0.25)]);
    for (const c of layout.cells) {
      ctx.strokeStyle = '#f2c200';
      ctx.beginPath();
      ctx.arc(X(c.robot[0]), Z(c.robot[1]), S(2.6), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // --- AGV parking / charging pads and kit pick point ---------------------------------------
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of layout.agvParking) {
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = S(0.08);
      ctx.strokeRect(X(p.pos[0] - 0.85), Z(p.pos[1] - 0.6), S(1.7), S(1.2));
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold ${S(0.32)}px ${FONT}`;
    const k = layout.kitting.pos;
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = S(0.08);
    ctx.strokeRect(X(k[0] + 1.0), Z(k[1] - 0.6), S(1.4), S(1.2));
    ctx.fillText('AGV PICK', X(k[0] + 1.7), Z(k[1]));

    // --- palletizer pads ---------------------------------------------------------------------------
    for (const p of layout.palletizer.positions) {
      ctx.strokeStyle = '#f4f4f4';
      ctx.lineWidth = S(0.08);
      ctx.strokeRect(X(p[0] - 0.7), Z(p[1] - 0.6), S(1.4), S(1.2));
    }

    // --- apron: truck bay lines + numbers ------------------------------------------------------
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = S(0.15);
    ctx.fillStyle = 'rgba(240,240,240,0.9)';
    ctx.font = `bold ${S(1.4)}px ${FONT}`;
    layout.receivingBays.forEach((bay, i) => {
      for (const dz of [-2.0, 2.0]) line(ctx, X(b.x0), Z(bay.door[1] + dz), X(GROUND.x0 + 1), Z(bay.door[1] + dz));
      ctx.fillText(`R${i + 1}`, X(GROUND.x0 + 3), Z(bay.door[1]));
    });
    layout.shippingBays.forEach((bay, i) => {
      for (const dz of [-2.0, 2.0]) line(ctx, X(b.x1), Z(bay.door[1] + dz), X(GROUND.x1 - 1), Z(bay.door[1] + dz));
      ctx.fillText(`S${i + 1}`, X(GROUND.x1 - 3), Z(bay.door[1]));
    });
    // building footprint edge (curb)
    ctx.strokeStyle = '#2d2f31';
    ctx.lineWidth = S(0.3);
    ctx.strokeRect(X(b.x0) - S(0.15), Z(b.z0) - S(0.15), S(b.x1 - b.x0) + S(0.3), S(b.z1 - b.z0) + S(0.3));
  });
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function polyline(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const bl = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${bl},${a})`;
}
