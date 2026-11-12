import * as THREE from 'three';
import type { KeypadKey } from '../core/types';
import { FONT, labelTexture, type MaterialSet } from './materials';
import { dyn, mesh, rbox, box } from './util';

/**
 * Encrypting PIN pad (generic): 4×4 steel keys on a brushed housing with a low PIN shield.
 * Local frame: key tops face +Z, keypad centred on the origin. The caller tilts it onto the deck.
 */
const ROWS: Array<Array<KeypadKey | '_'>> = [
  ['1', '2', '3', 'CANCEL'],
  ['4', '5', '6', 'CLEAR'],
  ['7', '8', '9', 'ENTER'],
  ['_', '0', '_', 'BLANK'],
];

export interface KeypadBuild {
  group: THREE.Group;
  keys: Map<KeypadKey, THREE.Mesh>;
  textures: THREE.Texture[];
  materials: THREE.Material[];
}

export function buildKeypad(m: MaterialSet): KeypadBuild {
  const group = new THREE.Group();
  group.name = 'keypad-assembly';
  const keys = new Map<KeypadKey, THREE.Mesh>();
  const textures: THREE.Texture[] = [];
  const materials: THREE.Material[] = [];

  // housing: bezel plate + recessed key field
  mesh(rbox(0.158, 0.126, 0.008, 0.004), m.brushedSteel, group, [0, 0, 0.004]);
  mesh(rbox(0.142, 0.11, 0.004, 0.002), m.satinBlack, group, [0, 0, 0.0085]);
  // PIN shield: two side wings and a back hood, higher at the back
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-0.063, 0);
  wingShape.lineTo(0.063, 0);
  wingShape.lineTo(0.063, 0.03);
  wingShape.quadraticCurveTo(0.0, 0.026, -0.063, 0.008);
  wingShape.lineTo(-0.063, 0);
  const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.003, bevelEnabled: false });
  // shape X → keypad Y (front→back), shape Y → keypad Z (height), extrusion → keypad X
  wingGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  for (const sx of [-1, 1]) mesh(wingGeo, m.brushedAlu, group, [sx * 0.0785 - 0.0015, 0, 0.008]);
  mesh(box(0.16, 0.003, 0.03), m.brushedAlu, group, [0, 0.0645, 0.023]);

  const steelFaceCache = new Map<string, THREE.MeshStandardMaterial>();
  const faceMat = (label: string, bg: string, fg: string, wide: boolean, sub?: string): THREE.MeshStandardMaterial => {
    const k = `${label}|${bg}`;
    const hit = steelFaceCache.get(k);
    if (hit) return hit;
    const tex = labelTexture({
      w: wide ? 192 : 128,
      h: 96,
      bg,
      lines: [
        { text: label, size: label.length > 1 ? 30 : 58, weight: '800', color: fg, y: sub ? 0.42 : 0.52 },
        ...(sub ? [{ text: sub, size: 18, weight: '600', color: fg, y: 0.8 }] : []),
      ],
    });
    textures.push(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: bg === '#c9cdd2' ? 0.75 : 0.1, roughness: 0.32 });
    materials.push(mat);
    steelFaceCache.set(k, mat);
    return mat;
  };

  const digitX = [-0.052, -0.021, 0.01];
  const fnX = 0.0485;
  const rowY = [0.0375, 0.0125, -0.0125, -0.0375];
  const digitGeo = rbox(0.025, 0.0195, 0.007, 0.0022);
  const fnGeo = rbox(0.036, 0.0195, 0.007, 0.0022);
  const letters: Record<string, string> = { '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ' };

  ROWS.forEach((row, r) => {
    row.forEach((k, c) => {
      const isFn = c === 3;
      const pos: [number, number, number] = [isFn ? fnX : digitX[c], rowY[r], 0.0125];
      let side: THREE.Material = m.brushedSteel;
      let face: THREE.Material;
      if (k === 'CANCEL') {
        side = m.keyRed;
        face = faceMat('CANCEL', '#c8261f', '#ffffff', true);
      } else if (k === 'CLEAR') {
        side = m.keyYellow;
        face = faceMat('CLEAR', '#e9b21a', '#1a1a1a', true);
      } else if (k === 'ENTER') {
        side = m.keyGreen;
        face = faceMat('ENTER', '#1f9a43', '#ffffff', true);
      } else if (k === 'BLANK' || k === '_') {
        face = faceMat('', '#c9cdd2', '#000', isFn);
      } else {
        face = faceMat(k, '#c9cdd2', '#15171a', false, letters[k]);
      }
      // BoxGeometry face order: +x, -x, +y, -y, +z, -z
      const key = mesh(isFn ? fnGeo : digitGeo, [side, side, side, side, face, side], group, pos);
      dyn(key);
      key.userData.componentId = 'keypad';
      const kk: KeypadKey = k === '_' ? 'BLANK' : k;
      key.userData.key = kk;
      key.userData.restZ = pos[2];
      key.name = `key-${k === '_' ? `spare-${c}` : k}`;
      if (k !== '_') keys.set(kk, key);
      if (k === '5') {
        // tactile locator dot
        const dot = mesh(new THREE.SphereGeometry(0.0013, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.brushedSteel, key, [0, -0.0055, 0.0035], [Math.PI / 2, 0, 0]);
        dot.userData.componentId = 'keypad';
        dot.userData.key = '5';
        dyn(dot);
      }
    });
  });

  // Small label strip under the keys
  const lbl = labelTexture({
    w: 512,
    h: 48,
    bg: null,
    lines: [{ text: 'SHIELD YOUR PIN  ·  PIN PAD (TRAINING)', size: 26, weight: '700', color: '#1d2024', y: 0.52, font: FONT }],
  });
  textures.push(lbl);
  const lblMat = new THREE.MeshStandardMaterial({ map: lbl, transparent: true, metalness: 0.5, roughness: 0.4 });
  materials.push(lblMat);
  mesh(new THREE.PlaneGeometry(0.11, 0.0065), lblMat, group, [0, -0.0592, 0.0082]);

  group.traverse((o) => {
    if (!o.userData.componentId) o.userData.componentId = 'keypad';
  });
  return { group, keys, textures, materials };
}
