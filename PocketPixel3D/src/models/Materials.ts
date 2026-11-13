import * as THREE from 'three';

/**
 * PBR materials and procedural textures for the console. Everything is generated at runtime from
 * canvases; there are no image assets. Call {@link Materials.dispose} to free GPU resources.
 */
export class Materials {
  readonly shell: THREE.MeshPhysicalMaterial;
  readonly shellInner: THREE.MeshStandardMaterial;
  readonly darkPlastic: THREE.MeshPhysicalMaterial;
  readonly burgundy: THREE.MeshPhysicalMaterial;
  readonly rubber: THREE.MeshStandardMaterial;
  readonly lens: THREE.MeshPhysicalMaterial;
  readonly lensEdge: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly recess: THREE.MeshStandardMaterial;
  readonly black: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly gold: THREE.MeshStandardMaterial;
  readonly pcb: THREE.MeshStandardMaterial;
  readonly chip: THREE.MeshStandardMaterial;
  readonly copper: THREE.MeshStandardMaterial;
  readonly membrane: THREE.MeshPhysicalMaterial;
  readonly carbon: THREE.MeshStandardMaterial;
  readonly led: THREE.MeshStandardMaterial;
  readonly lcdBacking: THREE.MeshStandardMaterial;
  readonly speakerCone: THREE.MeshStandardMaterial;
  readonly batteryWrap: THREE.MeshStandardMaterial;
  readonly cartridgePlastic: THREE.MeshPhysicalMaterial;

  /** Materials that fade in transparent-shell mode, with their opaque settings. */
  readonly shellGroup: THREE.Material[];

  private readonly textures: THREE.Texture[] = [];
  private readonly extra: THREE.Material[] = [];

  constructor(maxAnisotropy: number) {
    const noise = this.track(makeNoiseTexture(512, 1));
    noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
    noise.repeat.set(1 / 60, 1 / 60);
    noise.anisotropy = maxAnisotropy;
    noise.colorSpace = THREE.NoColorSpace;

    const fine = this.track(makeNoiseTexture(256, 2));
    fine.wrapS = fine.wrapT = THREE.RepeatWrapping;
    fine.repeat.set(1 / 18, 1 / 18);
    fine.colorSpace = THREE.NoColorSpace;

    const wear = this.track(makeWearTexture());
    wear.colorSpace = THREE.NoColorSpace;

    this.shell = new THREE.MeshPhysicalMaterial({
      name: 'shell',
      color: 0xc9c5bb,
      roughness: 0.62,
      roughnessMap: noise,
      bumpMap: fine,
      bumpScale: 0.35,
      clearcoat: 0.12,
      clearcoatRoughness: 0.55,
      sheen: 0.25,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(0xf2efe6),
    });
    this.shellInner = new THREE.MeshStandardMaterial({ name: 'shellInner', color: 0x8f8b82, roughness: 0.9 });
    this.darkPlastic = new THREE.MeshPhysicalMaterial({
      name: 'dpad',
      color: 0x26262b,
      roughness: 0.5,
      roughnessMap: wear,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
    });
    this.burgundy = new THREE.MeshPhysicalMaterial({
      name: 'abButtons',
      color: 0x8f1846,
      roughness: 0.42,
      roughnessMap: wear,
      clearcoat: 0.55,
      clearcoatRoughness: 0.25,
    });
    this.rubber = new THREE.MeshStandardMaterial({
      name: 'rubber',
      color: 0x7d7f87,
      roughness: 0.88,
      bumpMap: fine,
      bumpScale: 0.6,
    });
    this.lens = new THREE.MeshPhysicalMaterial({
      name: 'lens',
      color: 0xffffff,
      roughness: 0.32,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    this.lensEdge = new THREE.MeshStandardMaterial({ name: 'lensEdge', color: 0x32343d, roughness: 0.4 });
    // Glass: black base + additive blending → only the reflection is added on top of the LCD.
    this.glass = new THREE.MeshPhysicalMaterial({
      name: 'glass',
      color: 0x000000,
      roughness: 0.1,
      metalness: 0,
      specularIntensity: 0.5,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      envMapIntensity: 0.35,
    });
    // Add colour only; never touch destination alpha (the canvas is transparent over a CSS backdrop).
    this.glass.blending = THREE.CustomBlending;
    this.glass.blendEquation = THREE.AddEquation;
    this.glass.blendSrc = THREE.OneFactor;
    this.glass.blendDst = THREE.OneFactor;
    this.glass.blendSrcAlpha = THREE.ZeroFactor;
    this.glass.blendDstAlpha = THREE.OneFactor;
    this.recess = new THREE.MeshStandardMaterial({ name: 'recess', color: 0x1b1b1e, roughness: 0.85 });
    this.black = new THREE.MeshStandardMaterial({ name: 'black', color: 0x0d0d0f, roughness: 0.7 });
    this.steel = new THREE.MeshStandardMaterial({ name: 'steel', color: 0xa4a7ad, metalness: 1, roughness: 0.34 });
    this.gold = new THREE.MeshStandardMaterial({ name: 'gold', color: 0xd9ac52, metalness: 1, roughness: 0.28 });
    this.pcb = new THREE.MeshStandardMaterial({
      name: 'pcb',
      color: 0x1d5a38,
      roughness: 0.45,
      bumpMap: fine,
      bumpScale: 0.2,
    });
    this.chip = new THREE.MeshStandardMaterial({ name: 'chip', color: 0x18181a, roughness: 0.55 });
    this.copper = new THREE.MeshStandardMaterial({ name: 'copper', color: 0xc07a45, metalness: 0.9, roughness: 0.35 });
    this.membrane = new THREE.MeshPhysicalMaterial({
      name: 'membrane',
      color: 0x5a5d63,
      roughness: 0.75,
      transparent: true,
      opacity: 0.85,
    });
    this.carbon = new THREE.MeshStandardMaterial({ name: 'carbon', color: 0x111111, roughness: 0.6 });
    this.led = new THREE.MeshStandardMaterial({
      name: 'led',
      color: 0x3a0c0c,
      emissive: 0xff2a1a,
      emissiveIntensity: 0,
      roughness: 0.2,
    });
    this.lcdBacking = new THREE.MeshStandardMaterial({ name: 'lcdBacking', color: 0x889254, roughness: 0.7 });
    this.speakerCone = new THREE.MeshStandardMaterial({ name: 'speaker', color: 0x2a2620, roughness: 0.9 });
    this.batteryWrap = new THREE.MeshStandardMaterial({ name: 'battery', color: 0x2f6fb5, metalness: 0.4, roughness: 0.35 });
    this.cartridgePlastic = new THREE.MeshPhysicalMaterial({
      name: 'cartridge',
      color: 0xb9b6ae,
      roughness: 0.6,
      roughnessMap: noise,
      bumpMap: fine,
      bumpScale: 0.3,
      clearcoat: 0.1,
    });

    this.shellGroup = [this.shell, this.shellInner, this.lens, this.lensEdge, this.recess, this.rubber];
  }

  /** Registers a texture or material created elsewhere so it is disposed with the rest. */
  own<T extends THREE.Texture | THREE.Material>(item: T): T {
    if (item instanceof THREE.Texture) this.textures.push(item);
    else this.extra.push(item);
    return item;
  }

  private track<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  dispose(): void {
    for (const t of this.textures) t.dispose();
    for (const value of Object.values(this)) {
      if (value instanceof THREE.Material) value.dispose();
    }
    for (const m of this.extra) m.dispose();
  }
}

/** Seeded value-noise + speckle texture used for roughness/bump variation. */
function makeNoiseTexture(size: number, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  let s = seed * 9973;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  // Octaves of value noise on a wrapping lattice.
  const octave = (cells: number): Float32Array => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const at = (cx: number, cy: number): number => lattice[(cy % cells) * cells + (cx % cells)] ?? 0;
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
        out[y * size + x] = a + (b - a) * sy;
      }
    }
    return out;
  };
  const o1 = octave(4);
  const o2 = octave(16);
  const o3 = octave(64);
  for (let i = 0; i < size * size; i++) {
    let v = 0.5 * (o1[i] ?? 0) + 0.3 * (o2[i] ?? 0) + 0.2 * (o3[i] ?? 0);
    if (rand() < 0.004) v -= 0.25; // tiny pits / dust
    const c = Math.max(0, Math.min(255, Math.round((0.35 + v * 0.5) * 255)));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // A few faint scratches.
  ctx.strokeStyle = 'rgba(40,40,40,0.25)';
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    const x = rand() * size;
    const y = rand() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 60, y + (rand() - 0.5) * 60);
    ctx.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

/** Radial wear: smoother (darker = lower roughness) where thumbs rub the button tops. */
function makeWearTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  // Lathe UV v runs from the rim (0) to the cap centre (1); with flipY, v = 1 is the canvas top.
  grad.addColorStop(0, '#8a8a8a');
  grad.addColorStop(0.4, '#d8d8d8');
  grad.addColorStop(1, '#ffffff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
