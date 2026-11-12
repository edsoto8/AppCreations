import type { HouseLayout, WallDef } from '../../../src/sim/world/types';

function wall(id: string, ax: number, ay: number, bx: number, by: number, exterior = false): WallDef {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: exterior ? 0.2 : 0.12, height: 2.5, exterior };
}

/**
 * 7 x 4 m test house: room A (x 0..4) and room B (x 4..7) separated by a wall at x = 4 with a
 * 0.9 m doorway at y 1.5..2.4. A table (legs) in room A, a solid cabinet in room B. Dock in room A.
 * Wall centerlines lie on the room borders; interior free space starts at the wall face.
 */
export function testLayout(): HouseLayout {
  return {
    id: 'test',
    name: 'Test house',
    description: 'Two-room test layout',
    bounds: { x: -0.1, y: -0.1, w: 7.2, h: 4.2 },
    rooms: [
      { id: 'roomA', name: 'Room A', kind: 'living', rects: [{ x: 0, y: 0, w: 4, h: 4 }], floor: 'hardwood' },
      { id: 'roomB', name: 'Room B', kind: 'kitchen', rects: [{ x: 4, y: 0, w: 3, h: 4 }], floor: 'tile' },
    ],
    walls: [
      wall('w-s', 0, 0, 7, 0, true),
      wall('w-n', 0, 4, 7, 4, true),
      wall('w-w', 0, 0, 0, 4, true),
      wall('w-e', 7, 0, 7, 4, true),
      wall('w-mid-a', 4, 0, 4, 1.5),
      wall('w-mid-b', 4, 2.4, 4, 4),
    ],
    doors: [{ id: 'd1', center: { x: 4, y: 1.95 }, width: 0.9, axis: 'y', threshold: 0.012, wallThickness: 0.12 }],
    furniture: [
      { id: 'table', kind: 'diningTable', x: 2.2, y: 2.6, rotation: 0, w: 1.4, d: 0.8, h: 0.75 },
      { id: 'cabinet', kind: 'dresser', x: 6.4, y: 3.4, rotation: 0, w: 1.0, d: 0.5, h: 0.85 },
    ],
    obstacles: [],
    zones: [],
    rugs: [],
    cliffs: [],
    dirtPatches: [
      { kind: 'crumbs', x: 2.2, y: 2.6, radius: 0.6, amount: 20 },
      { kind: 'liquid', x: 5.5, y: 1.0, radius: 0.3, amount: 150 },
      { kind: 'stain', x: 5.8, y: 2.5, radius: 0.25, amount: 0.8 },
    ],
    // Dock against the south wall (face at y = 0.1) in room A, robot faces -y.
    dock: { x: 1.0, y: 0.1 + 0.47, theta: -Math.PI / 2 },
  };
}
