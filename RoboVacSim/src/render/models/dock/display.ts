import { CanvasTexture, Color, DataTexture, MeshStandardMaterial, SRGBColorSpace, type Texture } from 'three';
import type { Disposables } from '../shared/Disposables';
import { createCanvas2D, type Canvas2D } from '../shared/textures';

const W = 640;
const H = 128;

/**
 * Front status display rendered into a CanvasTexture. Redraws only when the text, the accent
 * colour or the battery level (by >= 1%) changes.
 */
export class StatusDisplay {
  readonly material: MeshStandardMaterial;
  private readonly texture: Texture;
  private readonly canvas: Canvas2D | null;
  private lastText = '';
  private lastBattery = -1;
  private lastAccent = '';

  constructor(track: Disposables) {
    this.canvas = createCanvas2D(W, H);
    this.texture = this.canvas ? new CanvasTexture(this.canvas.canvas) : new DataTexture(new Uint8Array([20, 30, 40, 255]), 1, 1);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;
    track.track(this.texture);
    this.material = track.track(
      new MeshStandardMaterial({ color: 0x000000, emissive: new Color(0xffffff), emissiveMap: this.texture, emissiveIntensity: 1.1, roughness: 0.12, metalness: 0 }),
    );
    this.material.name = 'statusDisplay';
  }

  update(text: string, battery: number, accent: string): void {
    const b = Math.round(Math.min(Math.max(battery, 0), 1) * 100);
    if (text === this.lastText && b === this.lastBattery && accent === this.lastAccent) return;
    this.lastText = text;
    this.lastBattery = b;
    this.lastAccent = accent;
    if (!this.canvas) return;
    const ctx = this.canvas.ctx;
    ctx.fillStyle = '#030507';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,160,190,0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(34, H / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eef6fb';
    ctx.font = '600 36px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    let label = text.toUpperCase();
    while (label.length > 3 && ctx.measureText(label).width > 400) label = label.slice(0, -1);
    ctx.fillText(label, 58, H / 2 + 2);
    // Battery gauge.
    const bx = 500;
    const by = 40;
    const bw = 96;
    const bh = 48;
    ctx.strokeStyle = 'rgba(230,240,248,0.85)';
    ctx.lineWidth = 4;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = 'rgba(230,240,248,0.85)';
    ctx.fillRect(bx + bw + 2, by + 14, 8, bh - 28);
    ctx.fillStyle = accent;
    ctx.fillRect(bx + 6, by + 6, Math.max(0, (bw - 12) * (b / 100)), bh - 12);
    ctx.fillStyle = 'rgba(230,240,248,0.75)';
    ctx.font = '500 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${b}%`, bx + bw / 2, by + bh + 18);
    ctx.textAlign = 'left';
    this.texture.needsUpdate = true;
  }
}
