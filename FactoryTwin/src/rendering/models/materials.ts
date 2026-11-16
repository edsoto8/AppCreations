import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import type { WorkerRole } from '../../simulation/types';

/**
 * Shared, module-level materials. Create once, reuse everywhere.
 *
 * Most static sub-assemblies are merged into one geometry with a `color` vertex attribute and
 * drawn with one of the three vertex-colour materials below (paint / metal / matte). This keeps a
 * whole machine body to a single draw call.
 */

export const PALETTE = {
  safetyYellow: '#f5c400',
  robotYellow: '#f0b400',
  machineGrey: '#d4d8dc',
  panelGrey: '#b9bfc5',
  machineBlue: '#1f5fa8',
  darkBlue: '#173f73',
  darkGrey: '#3d4349',
  charcoal: '#24282d',
  steel: '#8f98a1',
  aluminium: '#c3c9cf',
  rubber: '#18191b',
  safetyOrange: '#f26a1b',
  rackBlue: '#1d4f91',
  rackOrange: '#f07c1a',
  kraft: '#b98a52',
  kraftDark: '#9c7240',
  toteBlue: '#2a6bd1',
  reworkOrange: '#e8590c',
  wood: '#c79c64',
  white: '#f2f3f4',
  offWhite: '#e6e9ec',
  red: '#d32f2f',
  green: '#2e9e44',
  teal: '#14a39a',
  skin: '#d6a07a',
  navy: '#26314a',
  black: '#101113',
} as const;

/** Hi-vis vest colour per worker role. */
export const ROLE_VEST: Record<WorkerRole, string> = {
  assembler: '#ff7a1a',
  inspector: '#36c24a',
  packer: '#14b8a6',
  driver: '#f5d90a',
  floater: '#8b5cf6',
  technician: '#2f6fe0',
};

/** Hard-hat colour per worker role. */
export const ROLE_HAT: Record<WorkerRole, string> = {
  assembler: '#f5c400',
  inspector: '#f4f4f4',
  packer: '#f5c400',
  driver: '#f5c400',
  floater: '#2f6fe0',
  technician: '#f4f4f4',
};

// --- vertex-colour materials (merged static geometry) -----------------------------------
export const paintMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.12 });
export const metalMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.6 });
export const matteMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });

// --- glass ---------------------------------------------------------------------------------
export const glassMat = new MeshStandardMaterial({
  color: '#bcd8ea',
  transparent: true,
  opacity: 0.2,
  roughness: 0.04,
  metalness: 0.2,
  depthWrite: false,
  side: DoubleSide,
});

/** Amber-tinted polycarbonate (machine guards). */
export const guardGlassMat = new MeshStandardMaterial({
  color: '#f6e6c4',
  transparent: true,
  opacity: 0.14,
  roughness: 0.08,
  metalness: 0.1,
  depthWrite: false,
  side: DoubleSide,
});

// --- emissive --------------------------------------------------------------------------------
export const screenMat = new MeshStandardMaterial({
  color: '#0b1a2a',
  emissive: new Color('#3d9bff'),
  emissiveIntensity: 1.1,
  roughness: 0.25,
});

export const scanBeamMat = new MeshBasicMaterial({
  color: '#45e0ff',
  transparent: true,
  opacity: 0.38,
  blending: AdditiveBlending,
  depthWrite: false,
  side: DoubleSide,
  toneMapped: false,
});

function lamp(color: string, intensity = 3): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: new Color(color),
    emissiveIntensity: intensity,
    roughness: 0.3,
    toneMapped: false,
  });
}

/** Lit indicator-lamp materials, shared by stack lights, conveyor motors, vehicle beacons. */
export const lampMats = {
  red: lamp('#ff2a1f'),
  amber: lamp('#ffae00'),
  green: lamp('#25e05a'),
  blue: lamp('#2f7dff'),
  cyan: lamp('#22d8ff', 2.2),
  white: lamp('#fff6e0', 1.6),
  off: new MeshStandardMaterial({ color: '#2a2d31', roughness: 0.4, metalness: 0.2 }),
} as const;

export const workLightMat = new MeshStandardMaterial({
  color: '#ffffff',
  emissive: new Color('#fff3d6'),
  emissiveIntensity: 1.8,
  toneMapped: false,
});

// --- products & handling units (used with InstancedMesh by the sync layer) -------------------
/** Smart-home hub: geometry carries vertex colours (white shell, dark ring). */
export const productAMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05 });
/** Wireless speaker: vertex colours (charcoal fabric, grey caps). */
export const productBMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
export const cartonMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
/** Kit tote: geometry is white/grey; the material colour tints it blue. */
export const toteMat = new MeshStandardMaterial({ vertexColors: true, color: PALETTE.toteBlue, roughness: 0.55 });
/** Rework tote: same geometry, orange. */
export const reworkToteMat = new MeshStandardMaterial({ vertexColors: true, color: PALETTE.reworkOrange, roughness: 0.55 });
export const palletMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
/** Shrink-wrapped raw-material lot (includes its pallet). */
export const materialLotMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.05 });

// --- plain (non vertex-colour) materials for instanced primitives ------------------------------
export const aluminiumMat = new MeshStandardMaterial({ color: '#c9cfd5', roughness: 0.3, metalness: 0.7 });
export const steelMat = new MeshStandardMaterial({ color: '#7d868f', roughness: 0.4, metalness: 0.6 });
export const rubberMat = new MeshStandardMaterial({ color: '#1a1b1d', roughness: 0.9, metalness: 0 });
