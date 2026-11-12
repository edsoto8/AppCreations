import * as THREE from 'three';

/**
 * Shared PBR materials and procedural canvas textures for the ATM model.
 * Everything is generated at runtime (no downloaded images). Designed for a RoomEnvironment
 * PMREM env map + ACES tone mapping + sRGB output.
 */

// ───────────────────────────── deterministic noise ─────────────────────────────

/** Small seeded PRNG so procedural textures look the same on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not available');
  return { canvas, ctx };
}

export const FONT = "'Inter', 'Segoe UI', 'Helvetica Neue', 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif";

function canvasTex(canvas: HTMLCanvasElement, srgb: boolean, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

/** Smooth value noise (a few octaves) as a grey canvas. base/amp are 0..255. */
export function noiseCanvas(size: number, seed: number, base: number, amp: number, cells = 8, octaves = 4): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const rnd = mulberry32(seed);
  const img = ctx.createImageData(size, size);
  const field = new Float32Array(size * size);
  let ampSum = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const grid = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    // wrap so the texture tiles
    for (let i = 0; i <= n; i++) {
      grid[i * (n + 1) + n] = grid[i * (n + 1)];
      grid[n * (n + 1) + i] = grid[i];
    }
    const a = 1 / (1 << o);
    ampSum += a;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * n;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const g00 = grid[y0 * (n + 1) + x0];
        const g10 = grid[y0 * (n + 1) + x0 + 1];
        const g01 = grid[(y0 + 1) * (n + 1) + x0];
        const g11 = grid[(y0 + 1) * (n + 1) + x0 + 1];
        const v = g00 * (1 - sx) * (1 - sy) + g10 * sx * (1 - sy) + g01 * (1 - sx) * sy + g11 * sx * sy;
        field[y * size + x] += v * a;
      }
    }
  }
  for (let i = 0; i < field.length; i++) {
    const v = base + (field[i] / ampSum - 0.5) * 2 * amp;
    const c = Math.max(0, Math.min(255, v));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Horizontal brushed-metal streaks. */
function brushedCanvas(size: number, seed: number, base: number, amp: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const rnd = mulberry32(seed);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 3; i++) {
    const y = rnd() * size;
    const v = base + (rnd() - 0.5) * 2 * amp;
    ctx.strokeStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.25 + rnd() * 0.5})`;
    ctx.lineWidth = 0.5 + rnd() * 1.2;
    const x = rnd() * size;
    const len = size * (0.3 + rnd() * 0.9);
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y);
    ctx.lineTo(x + len / 2, y);
    ctx.stroke();
    // wrap horizontally
    ctx.beginPath();
    ctx.moveTo(x - len / 2 + size, y);
    ctx.lineTo(x + len / 2 + size, y);
    ctx.moveTo(x - len / 2 - size, y);
    ctx.lineTo(x + len / 2 - size, y);
    ctx.stroke();
  }
  return canvas;
}

// ───────────────────────────── label textures ─────────────────────────────

export interface LabelLine {
  text: string;
  size: number; // px
  weight?: string;
  color?: string;
  font?: string;
  /** Vertical position as a fraction of canvas height (centre of the line). */
  y: number;
  /** Horizontal alignment; default centre. */
  align?: CanvasTextAlign;
  x?: number; // fraction of width (for left/right align)
  letterSpacing?: number;
}

export interface LabelOpts {
  w: number;
  h: number;
  bg?: string | null;
  border?: { color: string; width: number; radius?: number };
  lines: LabelLine[];
  /** Extra drawing after the text. */
  draw?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Extra drawing before the text. */
  drawBefore?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawLabelCanvas(o: LabelOpts): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(o.w, o.h);
  if (o.bg) {
    ctx.fillStyle = o.bg;
    ctx.fillRect(0, 0, o.w, o.h);
  }
  o.drawBefore?.(ctx, o.w, o.h);
  if (o.border) {
    ctx.strokeStyle = o.border.color;
    ctx.lineWidth = o.border.width;
    const b = o.border.width / 2;
    roundRectPath(ctx, b, b, o.w - 2 * b, o.h - 2 * b, o.border.radius ?? 0);
    ctx.stroke();
  }
  for (const l of o.lines) {
    ctx.font = `${l.weight ?? '600'} ${l.size}px ${l.font ?? FONT}`;
    ctx.fillStyle = l.color ?? '#ffffff';
    ctx.textAlign = l.align ?? 'center';
    ctx.textBaseline = 'middle';
    const x = l.x !== undefined ? l.x * o.w : l.align === 'left' ? 0.05 * o.w : l.align === 'right' ? 0.95 * o.w : o.w / 2;
    if (l.letterSpacing) {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${l.letterSpacing}px`;
    }
    ctx.fillText(l.text, x, l.y * o.h);
    if (l.letterSpacing) (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
  }
  o.draw?.(ctx, o.w, o.h);
  return canvas;
}

export function labelTexture(o: LabelOpts): THREE.CanvasTexture {
  return canvasTex(drawLabelCanvas(o), true);
}

/** A material for a flat printed label/sticker. */
export function labelMaterial(o: LabelOpts, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const map = labelTexture(o);
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.55,
    metalness: 0,
    transparent: !o.bg,
    ...extra,
  });
}

// ───────────────────────────── shared material set ─────────────────────────────

export interface MaterialSet {
  brushedSteel: THREE.MeshStandardMaterial;
  brushedAlu: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  zinc: THREE.MeshStandardMaterial;
  frameGrey: THREE.MeshStandardMaterial;
  blackPlastic: THREE.MeshStandardMaterial;
  satinBlack: THREE.MeshStandardMaterial;
  greyPlastic: THREE.MeshStandardMaterial;
  lightPlastic: THREE.MeshStandardMaterial;
  bluePlastic: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  belt: THREE.MeshStandardMaterial;
  presenterBelt: THREE.MeshStandardMaterial;
  pcb: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  paper: THREE.MeshStandardMaterial;
  noteStackEdge: THREE.MeshStandardMaterial;
  lens: THREE.MeshStandardMaterial;
  smokedClear: THREE.MeshStandardMaterial;
  cable: THREE.MeshStandardMaterial;
  cableBlue: THREE.MeshStandardMaterial;
  cableRed: THREE.MeshStandardMaterial;
  cassetteBody: THREE.MeshStandardMaterial;
  rejectBody: THREE.MeshStandardMaterial;
  depositBody: THREE.MeshStandardMaterial;
  safeInterior: THREE.MeshStandardMaterial;
  throatDark: THREE.MeshStandardMaterial;
  keyRed: THREE.MeshStandardMaterial;
  keyYellow: THREE.MeshStandardMaterial;
  keyGreen: THREE.MeshStandardMaterial;
  accentTeal: THREE.MeshStandardMaterial;
  yellowPaint: THREE.MeshStandardMaterial;
  orangePlastic: THREE.MeshStandardMaterial;
  greenPlastic: THREE.MeshStandardMaterial;
  sensorGlow: THREE.MeshStandardMaterial;
  scanGlow: THREE.MeshStandardMaterial;
  tealGlow: THREE.MeshStandardMaterial;
  warmGlow: THREE.MeshStandardMaterial;
  /** Textures owned by the set (also referenced by the materials). */
  textures: THREE.Texture[];
}

export interface ShellMaterialSet {
  sidePaint: THREE.MeshStandardMaterial;
  topPaint: THREE.MeshStandardMaterial;
  rearPaint: THREE.MeshStandardMaterial;
  fascia: THREE.MeshStandardMaterial;
  fasciaTrim: THREE.MeshStandardMaterial;
  plinth: THREE.MeshStandardMaterial;
  vaultPaint: THREE.MeshStandardMaterial;
  vaultInner: THREE.MeshStandardMaterial;
  safeWall: THREE.MeshStandardMaterial;
  doorInner: THREE.MeshStandardMaterial;
  sideGraphic: THREE.MeshStandardMaterial;
  rearPlate: THREE.MeshStandardMaterial;
  vent: THREE.MeshStandardMaterial;
  textures: THREE.Texture[];
}

export const BRAND = {
  navy: 0x12283f,
  navyCss: '#12283f',
  teal: 0x18b3a3,
  tealCss: '#18b3a3',
  charcoal: 0x26292d,
};

function std(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial(p);
}

function glow(color: number, intensity: number): THREE.MeshStandardMaterial {
  return std({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
}

export function createMaterials(): MaterialSet {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  const brushedRough = keep(canvasTex(brushedCanvas(512, 11, 120, 60), false, [2, 2]));
  const brushedColor = keep(canvasTex(brushedCanvas(512, 12, 225, 22), true, [2, 2]));
  const wearRough = keep(canvasTex(noiseCanvas(256, 21, 150, 70, 4), false, [1, 1]));
  const fineRough = keep(canvasTex(noiseCanvas(256, 22, 128, 50, 16, 3), false, [3, 3]));

  // Paper stack edge: thin cream lines with slight variation (used on note stack sides).
  const stackCanvas = (() => {
    const { canvas, ctx } = makeCanvas(64, 256);
    const rnd = mulberry32(5);
    for (let y = 0; y < 256; y++) {
      const v = 200 + rnd() * 50;
      ctx.fillStyle = `rgb(${v | 0},${(v - 8) | 0},${(v - 30) | 0})`;
      ctx.fillRect(0, y, 64, 1);
    }
    return canvas;
  })();
  const stackTex = keep(canvasTex(stackCanvas, true));
  stackTex.wrapS = stackTex.wrapT = THREE.RepeatWrapping;
  stackTex.repeat.set(1, 4);

  // Rubber belt: ribs that scroll when the motor runs.
  const beltCanvas = (() => {
    const { canvas, ctx } = makeCanvas(32, 128);
    ctx.fillStyle = '#1b1c1e';
    ctx.fillRect(0, 0, 32, 128);
    ctx.fillStyle = '#3a3c40';
    for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y, 32, 5);
    return canvas;
  })();
  const beltTex = keep(canvasTex(beltCanvas, true));
  beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping;
  beltTex.repeat.set(1, 30);
  const presenterBeltTex = keep(beltTex.clone());
  presenterBeltTex.repeat.set(1, 12);

  return {
    brushedSteel: std({ color: 0xc8ccd1, map: brushedColor, metalness: 1, roughness: 0.42, roughnessMap: brushedRough }),
    brushedAlu: std({ color: 0xdfe3e7, map: brushedColor, metalness: 1, roughness: 0.32, roughnessMap: brushedRough }),
    chrome: std({ color: 0xeef0f2, metalness: 1, roughness: 0.12 }),
    darkMetal: std({ color: 0x3b4047, metalness: 0.7, roughness: 0.5, roughnessMap: wearRough }),
    zinc: std({ color: 0xaab1b8, metalness: 0.85, roughness: 0.42, roughnessMap: fineRough }),
    frameGrey: std({ color: 0x6d747c, metalness: 0.6, roughness: 0.48, roughnessMap: wearRough }),
    blackPlastic: std({ color: 0x17191c, metalness: 0, roughness: 0.55, roughnessMap: wearRough }),
    satinBlack: std({ color: 0x0e0f11, metalness: 0.2, roughness: 0.32 }),
    greyPlastic: std({ color: 0x5b6169, metalness: 0, roughness: 0.6 }),
    lightPlastic: std({ color: 0xd6d9dc, metalness: 0, roughness: 0.5 }),
    bluePlastic: std({ color: 0x2c5d8f, metalness: 0, roughness: 0.5 }),
    rubber: std({ color: 0x101112, metalness: 0, roughness: 0.92 }),
    belt: std({ map: beltTex, roughness: 0.85, metalness: 0 }),
    presenterBelt: std({ map: presenterBeltTex, roughness: 0.85, metalness: 0 }),
    pcb: std({ color: 0x1e6a3b, metalness: 0.1, roughness: 0.45 }),
    copper: std({ color: 0xc27a43, metalness: 1, roughness: 0.35 }),
    brass: std({ color: 0xc9a54a, metalness: 1, roughness: 0.3 }),
    paper: std({ color: 0xf3f0e7, metalness: 0, roughness: 0.85 }),
    noteStackEdge: std({ map: stackTex, metalness: 0, roughness: 0.9 }),
    lens: std({ color: 0x04060a, metalness: 0.3, roughness: 0.04 }),
    smokedClear: std({ color: 0x2a3a4a, metalness: 0, roughness: 0.08, transparent: true, opacity: 0.32, depthWrite: false }),
    cable: std({ color: 0x141414, metalness: 0, roughness: 0.7 }),
    cableBlue: std({ color: 0x1f4fa8, metalness: 0, roughness: 0.6 }),
    cableRed: std({ color: 0xa82020, metalness: 0, roughness: 0.6 }),
    cassetteBody: std({ color: 0x2c3138, metalness: 0.45, roughness: 0.5, roughnessMap: wearRough }),
    rejectBody: std({ color: 0x5a2e2e, metalness: 0.4, roughness: 0.5, roughnessMap: wearRough }),
    depositBody: std({ color: 0x24465f, metalness: 0.45, roughness: 0.5, roughnessMap: wearRough }),
    safeInterior: std({ color: 0xb7bcc0, metalness: 0.2, roughness: 0.75, roughnessMap: wearRough }),
    throatDark: std({ color: 0x050506, metalness: 0, roughness: 0.9 }),
    keyRed: std({ color: 0xc8261f, metalness: 0.1, roughness: 0.35 }),
    keyYellow: std({ color: 0xe9b21a, metalness: 0.1, roughness: 0.35 }),
    keyGreen: std({ color: 0x1f9a43, metalness: 0.1, roughness: 0.35 }),
    accentTeal: std({ color: BRAND.teal, metalness: 0.3, roughness: 0.35 }),
    yellowPaint: std({ color: 0xe0b020, metalness: 0.2, roughness: 0.5 }),
    orangePlastic: std({ color: 0xe06a1b, metalness: 0, roughness: 0.5 }),
    greenPlastic: std({ color: 0x2f8f4f, metalness: 0, roughness: 0.5 }),
    sensorGlow: glow(0x2266ff, 1.2),
    scanGlow: glow(0x2266ff, 1.0),
    tealGlow: glow(BRAND.teal, 2.2),
    warmGlow: glow(0xfff1d6, 2.0),
    textures,
  };
}

/** Painted metal/plastic skin. These instances belong to the shell only (X-ray / cutaway modify them). */
export function createShellMaterials(): ShellMaterialSet {
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };
  const paintBump = keep(canvasTex(noiseCanvas(256, 31, 128, 40, 32, 2), false, [6, 6]));
  const paintRough = keep(canvasTex(noiseCanvas(512, 32, 120, 45, 3, 5), false, [1, 1]));
  const fasciaRough = keep(canvasTex(noiseCanvas(256, 33, 150, 30, 48, 2), false, [4, 4]));

  // Side graphic: brand wordmark + accent line, printed on the side skin.
  const sideCanvas = drawLabelCanvas({
    w: 1024,
    h: 2048,
    bg: BRAND.navyCss,
    lines: [],
    draw(ctx, w, h) {
      // subtle diagonal gradient
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // teal swoosh band
      ctx.fillStyle = BRAND.tealCss;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.62);
      ctx.bezierCurveTo(w * 0.4, h * 0.56, w * 0.7, h * 0.5, w, h * 0.38);
      ctx.lineTo(w, h * 0.41);
      ctx.bezierCurveTo(w * 0.7, h * 0.53, w * 0.4, h * 0.59, 0, h * 0.655);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.translate(w * 0.5, h * 0.25);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = `700 120px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('MERIDIAN', 0, 0);
      ctx.font = `500 54px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('TRAINING BANK', 0, 80);
      ctx.font = `600 44px ${FONT}`;
      ctx.fillStyle = BRAND.tealCss;
      ctx.fillText('24h  CASH & DEPOSITS', 0, 190);
      ctx.restore();
      ctx.font = `500 30px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.textAlign = 'center';
      ctx.fillText('TRAINING EQUIPMENT · FICTIONAL BANK', w / 2, h * 0.93);
    },
  });
  const sideTex = keep(canvasTex(sideCanvas, true));

  // Rear rating plate.
  const plateTex = keep(
    labelTexture({
      w: 512,
      h: 320,
      bg: '#c9ccd0',
      border: { color: '#33373c', width: 6, radius: 14 },
      lines: [
        { text: 'MERIDIAN TRAINING BANK', size: 34, weight: '700', color: '#1b1e22', y: 0.14 },
        { text: 'Model MTB-T200 · Lobby ATM (training)', size: 24, weight: '500', color: '#1b1e22', y: 0.32 },
        { text: 'Serial TRN-000001', size: 24, weight: '500', color: '#1b1e22', y: 0.46 },
        { text: '100–240 V~ 50/60 Hz · 3.2 A', size: 24, weight: '500', color: '#1b1e22', y: 0.6 },
        { text: 'NOT A REAL ATM — SIMULATOR ASSET', size: 24, weight: '800', color: '#9a1c1c', y: 0.8 },
      ],
    }),
  );

  // Vent slots texture (alpha) for rear panel louvres.
  const ventCanvas = (() => {
    const { canvas, ctx } = makeCanvas(256, 256);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#fff';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 2; c++) {
        roundRectPath(ctx, 14 + c * 124, 10 + r * 31, 104, 14, 7);
        ctx.fill();
      }
    }
    return canvas;
  })();
  const ventTex = keep(canvasTex(ventCanvas, false));

  return {
    sidePaint: std({ color: BRAND.navy, metalness: 0.35, roughness: 0.38, roughnessMap: paintRough, bumpMap: paintBump, bumpScale: 0.25 }),
    topPaint: std({ color: BRAND.navy, metalness: 0.35, roughness: 0.4, roughnessMap: paintRough, bumpMap: paintBump, bumpScale: 0.25 }),
    rearPaint: std({ color: 0x1a2733, metalness: 0.3, roughness: 0.5, roughnessMap: paintRough, bumpMap: paintBump, bumpScale: 0.3 }),
    fascia: std({ color: BRAND.charcoal, metalness: 0.15, roughness: 0.55, roughnessMap: fasciaRough }),
    fasciaTrim: std({ color: 0xd9dde2, metalness: 1, roughness: 0.28 }),
    plinth: std({ color: 0x0d0e10, metalness: 0.1, roughness: 0.75 }),
    vaultPaint: std({ color: 0x9aa1a8, metalness: 0.55, roughness: 0.42, roughnessMap: paintRough, bumpMap: paintBump, bumpScale: 0.3 }),
    vaultInner: std({ color: 0x8c9399, metalness: 0.5, roughness: 0.6, roughnessMap: paintRough }),
    safeWall: std({ color: 0x7d858c, metalness: 0.45, roughness: 0.6, roughnessMap: paintRough }),
    doorInner: std({ color: 0x3a3e44, metalness: 0.5, roughness: 0.6, roughnessMap: paintRough }),
    sideGraphic: std({ color: 0xffffff, map: sideTex, metalness: 0.35, roughness: 0.38, roughnessMap: paintRough }),
    rearPlate: std({ map: plateTex, metalness: 0.6, roughness: 0.35 }),
    vent: std({ color: 0x050607, metalness: 0, roughness: 1, alphaMap: ventTex, transparent: true, depthWrite: false }),
    textures,
  };
}

/** Dispose every material (and its own textures) in a set. */
export function disposeSet(set: { textures: THREE.Texture[] } & Record<string, unknown>): void {
  for (const v of Object.values(set)) {
    if (v instanceof THREE.Material) v.dispose();
  }
  for (const t of set.textures) t.dispose();
}
