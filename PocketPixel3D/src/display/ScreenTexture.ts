import * as THREE from 'three';
import type { LCDRenderer } from './LCDRenderer';

/**
 * Bridges the LCD canvas to a Three.js texture. Magnification is nearest-neighbour so pixels stay
 * crisp up close; mipmaps keep the grid from shimmering at a distance. Uploads only when the LCD
 * actually changed.
 */
export class ScreenTexture {
  readonly texture: THREE.CanvasTexture;
  private uploaded = -1;

  constructor(
    private readonly lcd: LCDRenderer,
    anisotropy: number,
  ) {
    this.texture = new THREE.CanvasTexture(lcd.screenCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.anisotropy = anisotropy;
  }

  /** Applies the texture to the screen material. */
  attach(material: THREE.MeshBasicMaterial): void {
    material.map = this.texture;
    material.needsUpdate = true;
  }

  sync(): void {
    if (this.lcd.frameVersion !== this.uploaded) {
      this.uploaded = this.lcd.frameVersion;
      this.texture.needsUpdate = true;
    }
  }

  dispose(): void {
    this.texture.dispose();
  }
}
