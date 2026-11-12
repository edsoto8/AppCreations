import * as THREE from 'three';
import type { TextureLibrary } from './textures';

/**
 * Material keys are `type` or `type|#rrggbb`. Materials are shared by every mesh using the same
 * key and reference counted, so removing the last item that uses a color disposes its material.
 */
export type MatKey = string;

interface Entry {
  mat: THREE.Material;
  refs: number;
}

const DEFAULT_COLORS: Record<string, string> = {
  wood: '#8b5e3c',
  paint: '#e8e4dc',
  gloss: '#f2f2f0',
  fabric: '#7d8794',
  linen: '#f1eee8',
  leather: '#5a3e2b',
  metal: '#9aa0a6',
  steel: '#c9ccd0',
  plastic: '#e9e9e6',
  cardboard: '#b48a5a',
  stone: '#e8e6e1',
  leaf: '#5c8a4e',
  rugPattern: '#8a6a5c',
  rugCarpet: '#a59c8f',
};

export class MaterialLibrary {
  private readonly cache = new Map<MatKey, Entry>();

  constructor(private readonly textures: TextureLibrary) {}

  acquire(key: MatKey): THREE.Material {
    let e = this.cache.get(key);
    if (!e) {
      e = { mat: this.create(key), refs: 0 };
      this.cache.set(key, e);
    }
    e.refs++;
    return e.mat;
  }

  release(key: MatKey): void {
    const e = this.cache.get(key);
    if (!e) return;
    e.refs--;
    if (e.refs <= 0) {
      e.mat.dispose();
      this.cache.delete(key);
    }
  }

  /** Number of live materials (for leak checks). */
  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const e of this.cache.values()) e.mat.dispose();
    this.cache.clear();
  }

  private create(key: MatKey): THREE.Material {
    const [type, colorStr] = key.split('|');
    const color = new THREE.Color(colorStr ?? DEFAULT_COLORS[type] ?? '#cccccc');
    const T = this.textures;
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ color, ...p });
    switch (type) {
      // ---- furniture ----
      case 'wood':
        return std({ map: T.get('woodGrain'), roughness: 0.52, metalness: 0 });
      case 'paint':
        return std({ roughness: 0.6, metalness: 0 });
      case 'paintVC':
        return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
      case 'plasticVC':
        return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 });
      case 'glossVC':
        return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05 });
      case 'gloss':
        return std({ roughness: 0.28, metalness: 0.05 });
      case 'fabric':
        return std({ map: T.get('fabric'), bumpMap: T.get('fabric'), bumpScale: 0.6, roughness: 0.95, metalness: 0 });
      case 'linen':
        return std({ map: T.get('fabric'), roughness: 0.9, metalness: 0 });
      case 'leather':
        return std({ roughness: 0.42, metalness: 0 });
      case 'metal':
        return std({ roughness: 0.38, metalness: 0.85 });
      case 'steel':
        return std({ roughness: 0.3, metalness: 0.9 });
      case 'chrome':
        return new THREE.MeshStandardMaterial({ color: '#e6e8ea', roughness: 0.12, metalness: 1 });
      case 'brass':
        return new THREE.MeshStandardMaterial({ color: '#c9a45c', roughness: 0.3, metalness: 1 });
      case 'black':
        return new THREE.MeshStandardMaterial({ color: '#232427', roughness: 0.45, metalness: 0.45 });
      case 'rubber':
        return new THREE.MeshStandardMaterial({ color: '#1b1b1c', roughness: 0.9, metalness: 0 });
      case 'plastic':
        return std({ roughness: 0.4, metalness: 0 });
      case 'cardboard':
        return std({ roughness: 0.92, metalness: 0 });
      case 'ceramic':
        return new THREE.MeshStandardMaterial({ color: '#f7f7f4', roughness: 0.1, metalness: 0 });
      case 'glassDark':
        return new THREE.MeshStandardMaterial({ color: '#101317', roughness: 0.06, metalness: 0.4 });
      case 'screen':
        return new THREE.MeshStandardMaterial({ color: '#06080b', roughness: 0.16, metalness: 0.2, emissive: '#0a1420', emissiveIntensity: 0.6 });
      case 'mirror':
        return new THREE.MeshStandardMaterial({ color: '#e9eef2', roughness: 0.02, metalness: 1 });
      case 'stone':
        return std({ map: T.get('stone'), roughness: 0.25, metalness: 0 });
      case 'leaf':
        return std({ roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
      case 'soil':
        return new THREE.MeshStandardMaterial({ color: '#3a2a1f', roughness: 1, metalness: 0 });
      case 'shade':
        return new THREE.MeshStandardMaterial({
          color: '#f3ead8',
          emissive: '#ffd8a0',
          emissiveIntensity: 0.85,
          roughness: 0.9,
          side: THREE.DoubleSide,
        });
      case 'bulb':
        return new THREE.MeshStandardMaterial({ color: '#fff6e6', emissive: '#fff0d0', emissiveIntensity: 2.2 });
      case 'book':
        return new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, metalness: 0 });
      case 'kibble':
        return new THREE.MeshStandardMaterial({ color: '#7a4a24', roughness: 0.85 });

      // ---- floors ----
      case 'floorHardwood':
        return new THREE.MeshStandardMaterial({ map: T.get('hardwood'), roughnessMap: T.get('hardwoodRough'), roughness: 1, metalness: 0 });
      case 'floorTile':
        return new THREE.MeshStandardMaterial({ map: T.get('tile'), roughnessMap: T.get('tileRough'), roughness: 1, metalness: 0, envMapIntensity: 1.2 });
      case 'floorCarpet':
        return new THREE.MeshStandardMaterial({ color: '#b3a99b', map: T.get('carpet'), bumpMap: T.get('carpet'), bumpScale: 1.2, roughness: 1, metalness: 0 });
      case 'floorRug':
        return new THREE.MeshStandardMaterial({ color: '#9c8f80', map: T.get('carpet'), bumpMap: T.get('carpet'), bumpScale: 0.8, roughness: 0.97, metalness: 0 });
      case 'rugPattern':
        return std({ map: T.get('rug'), roughness: 0.96, metalness: 0 });
      case 'rugCarpet':
        return std({ map: T.get('carpet'), bumpMap: T.get('carpet'), bumpScale: 1.2, roughness: 1, metalness: 0 });

      // ---- architecture ----
      case 'wallInt':
        return new THREE.MeshStandardMaterial({ color: '#eceae5', roughness: 0.92, metalness: 0 });
      case 'wallExt':
        return new THREE.MeshStandardMaterial({ color: '#d6d2ca', roughness: 0.93, metalness: 0 });
      case 'capFull':
        return new THREE.MeshStandardMaterial({ color: '#cfcac1', roughness: 0.9, metalness: 0 });
      case 'capCut':
        return new THREE.MeshStandardMaterial({ color: '#3a3e44', roughness: 0.85, metalness: 0 });
      case 'trim':
        return new THREE.MeshStandardMaterial({ color: '#f6f4ef', roughness: 0.45, metalness: 0 });
      case 'threshold':
        return new THREE.MeshStandardMaterial({ color: '#b8b0a2', roughness: 0.35, metalness: 0.7 });
      case 'stairTread':
        return new THREE.MeshStandardMaterial({ color: '#a77b52', map: T.get('woodGrain'), roughness: 0.5, metalness: 0 });
      case 'stairRiser':
        return new THREE.MeshStandardMaterial({ color: '#e9e6df', roughness: 0.8, metalness: 0 });
      case 'stairShaft':
        return new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.95, metalness: 0 });
      case 'stairDark':
        return new THREE.MeshStandardMaterial({ color: '#1d1f23', roughness: 1, metalness: 0 });
      case 'nosing':
        return new THREE.MeshStandardMaterial({ color: '#c0c3c6', roughness: 0.3, metalness: 0.9 });
      default:
        return std({ roughness: 0.6 });
    }
  }
}
