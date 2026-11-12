import type { HouseLayout, Rect } from '../types';
import { BED_FOOT, FACING, WallSet, chairsAround, furn, obst, p } from './helpers';

/**
 * Deliberate narrow gaps in the obstacle-challenge layout (sim rects covering the gap area).
 * - `passable`:   0.50 m between the reading-nook bookshelf and the playroom north wall (x-crossing).
 * - `impassable`: 0.38 m between the toy-corner shelf and the playroom east wall; the toy corner
 *                 behind it can only be reached through this gap, so it stays unreachable.
 */
export const CHALLENGE_GAPS: {
  passable: { rect: Rect; width: number; behind: { x: number; y: number } };
  impassable: { rect: Rect; width: number; behind: { x: number; y: number } };
} = {
  passable: { rect: { x: 10.4, y: 4.44, w: 0.35, h: 0.5 }, width: 0.5, behind: { x: 11.3, y: 4.2 } },
  impassable: { rect: { x: 11.52, y: 1.32, w: 0.38, h: 0.35 }, width: 0.38, behind: { x: 11.2, y: 0.7 } },
};

/**
 * Obstacle challenge, 12 x 9 m (wall centerlines).
 *
 *   y=9 +----------+----+-----------+--------+
 *       | kitchen  |cul-| bedroom   | office |
 *       | pet bowl |de- | (carpet)  |  [cliff|
 *       | (no-go)  |sac |          d|  stair]|
 *   y=5 +--psg-----+-d--+-----------+--------+
 *       | cafe: chairs + stools   d playroom |
 *       | (dense legs, cable)       carpet   |
 *       |                 (no-mop) nook/toys |
 *   y=0 +-----------------+------------------+
 *      x=0               x=6                x=12
 */
export function buildChallenge(): HouseLayout {
  const ws = new WallSet()
    .perimeter(0, 0, 12, 9)
    .int('wall-cafe-play', p(6, 0), p(6, 5), [{ at: 2.6, width: 1.0, id: 'door-cafe-playroom' }])
    .int('wall-mid', p(0, 5), p(12, 5), [
      { at: 1.2, width: 1.6, door: false },
      { at: 5.0, width: 0.9, id: 'door-culdesac' },
    ])
    .int('wall-kitchen-hall', p(4.4, 5), p(4.4, 9))
    .int('wall-hall-bedroom', p(5.6, 5), p(5.6, 9), [{ at: 0.9, width: 0.9, id: 'door-bedroom' }])
    .int('wall-bedroom-office', p(9.4, 5), p(9.4, 9), [{ at: 1.0, width: 0.9, id: 'door-office' }]);

  const t1 = { x: 1.6, y: 1.6, w: 1.6, d: 0.9 };
  const t2 = { x: 4.4, y: 1.6, w: 1.0, d: 1.0 };
  const kt = { x: 2.2, y: 6.7, w: 0.8, d: 0.8 };

  return {
    id: 'challenge',
    name: 'Obstacle challenge',
    description:
      'Stress test: dense chair and stool legs, a 0.5 m and a 0.38 m gap, clutter on the floor, a no-go zone, a no-mop carpet, a stairwell drop and a cul-de-sac.',
    bounds: { x: -0.1, y: -0.1, w: 12.2, h: 9.2 },
    rooms: [
      { id: 'cafe', name: 'Dining hall', kind: 'dining', rects: [{ x: 0, y: 0, w: 6, h: 5 }], floor: 'hardwood' },
      { id: 'playroom', name: 'Playroom', kind: 'living', rects: [{ x: 6, y: 0, w: 6, h: 5 }], floor: 'hardwood' },
      { id: 'kitchen', name: 'Kitchen', kind: 'kitchen', rects: [{ x: 0, y: 5, w: 4.4, h: 4 }], floor: 'tile' },
      { id: 'culdesac', name: 'Dead-end hall', kind: 'hallway', rects: [{ x: 4.4, y: 5, w: 1.2, h: 4 }], floor: 'hardwood' },
      { id: 'bedroom', name: 'Bedroom', kind: 'bedroom', rects: [{ x: 5.6, y: 5, w: 3.8, h: 4 }], floor: 'carpet' },
      { id: 'office', name: 'Office', kind: 'office', rects: [{ x: 9.4, y: 5, w: 2.6, h: 4 }], floor: 'hardwood' },
    ],
    walls: ws.walls,
    doors: ws.doors,
    furniture: [
      // Dining hall: two tables with tucked chairs, a bar with stools - a forest of legs.
      furn('cafe-table-1', 'diningTable', t1.x, t1.y, 0, { w: t1.w, d: t1.d }),
      ...chairsAround('cafe-table-1-chair', t1, { perSide: 2, ends: true }),
      furn('cafe-table-2', 'diningTable', t2.x, t2.y, 0, { w: t2.w, d: t2.d }),
      ...chairsAround('cafe-table-2-chair', t2, { perSide: 1, ends: true, color: '#3d3d3d' }),
      furn('cafe-bar', 'kitchenIsland', 3.2, 4.63, FACING.negY, { w: 2.4, d: 0.6, color: '#6b4a32' }),
      furn('cafe-stool-1', 'barStool', 2.3, 4.05, FACING.posY),
      furn('cafe-stool-2', 'barStool', 2.9, 4.05, FACING.posY),
      furn('cafe-stool-3', 'barStool', 3.5, 4.05, FACING.posY),
      furn('cafe-stool-4', 'barStool', 4.1, 4.05, FACING.posY),
      furn('cafe-plant', 'plant', 5.6, 0.45, 0),
      furn('cafe-floor-lamp', 'floorLamp', 0.35, 3.2, 0),
      // Playroom.
      furn('play-sofa', 'sofa', 8.2, 0.57, FACING.posY, { color: '#7b8a9a' }),
      furn('play-tv-stand', 'tvStand', 8.2, 4.72, FACING.negY),
      furn('play-coffee-table', 'coffeeTable', 8.2, 2.4, 0),
      furn('play-armchair', 'armchair', 9.7, 2.4, FACING.negX),
      // Toy corner (SE), closed by a wardrobe and a low shelf - 0.38 m gap to the east wall.
      furn('play-wardrobe', 'wardrobe', 10.25, 0.72, FACING.posX, { w: 1.2, d: 0.5 }),
      furn('play-toy-shelf', 'bookshelf', 11.01, 1.495, FACING.negY, { w: 1.02, h: 1.1 }),
      // Reading nook (NE), closed by a bookshelf and a dresser - 0.5 m gap to the north wall.
      furn('play-nook-shelf', 'bookshelf', 10.575, 3.94, FACING.negX),
      furn('play-dresser', 'dresser', 11.33, 3.2, FACING.negY, { w: 1.1 }),
      // Kitchen.
      furn('kitchen-fridge', 'fridge', 0.51, 8.53, FACING.negY),
      furn('kitchen-counter-north', 'kitchenCounter', 2.0, 8.58, FACING.negY, { w: 2.1 }),
      furn('kitchen-stove', 'stove', 3.45, 8.57, FACING.negY),
      furn('kitchen-counter-east', 'kitchenCounter', 4.02, 7.4, FACING.negX, { w: 1.6 }),
      furn('kitchen-table', 'diningTable', kt.x, kt.y, 0, { w: kt.w, d: kt.d }),
      ...chairsAround('kitchen-chair', { ...kt, rotated: true }, { perSide: 1, ends: false }),
      // Bedroom.
      furn('bedroom-bed', 'bed', 7.5, 7.84, BED_FOOT.negY),
      furn('bedroom-nightstand-left', 'nightstand', 6.4, 8.69, FACING.negY),
      furn('bedroom-nightstand-right', 'nightstand', 8.6, 8.69, FACING.negY),
      furn('bedroom-dresser', 'dresser', 8.4, 5.32, FACING.posY),
      // Office (stairwell in the NE corner).
      furn('office-desk', 'desk', 9.82, 7.9, FACING.posX),
      furn('office-chair', 'officeChair', 10.45, 7.9, FACING.negX),
      furn('office-bookshelf', 'bookshelf', 10.9, 5.245, FACING.posY),
      furn('office-plant', 'plant', 11.6, 6.3, 0),
    ],
    obstacles: [
      obst('cafe-box', 'box', 0.45, 4.2, 0),
      obst('cafe-cable', 'cable', 3.15, 3.0, 0.3),
      obst('cafe-shoe-1', 'shoe', 5.6, 4.3, Math.PI / 2),
      obst('cafe-shoe-2', 'shoe', 5.76, 4.25, Math.PI / 2 - 0.2),
      obst('play-toy-1', 'toy', 8.9, 1.9, 0.3),
      obst('play-toy-2', 'toy', 7.4, 3.2, 0.5, { w: 0.12, d: 0.12, h: 0.12 }),
      obst('play-toy-3', 'toy', 11.2, 0.55, 0.2),
      obst('play-toy-4', 'toy', 10.85, 0.95, 0.7, { w: 0.2, d: 0.2, h: 0.2 }),
      obst('play-sock-1', 'sock', 9.3, 3.5, 0.7),
      obst('play-sock-2', 'sock', 6.6, 0.5, 1.2),
      obst('play-cable', 'cable', 8.2, 4.3, 0),
      obst('play-box', 'box', 11.3, 2.3, 0.2),
      obst('kitchen-pet-food', 'petBowl', 0.5, 6.4),
      obst('kitchen-pet-water', 'petBowl', 0.78, 6.4),
      obst('kitchen-trash', 'cylinder', 4.1, 6.3),
      obst('hall-shoe', 'shoe', 4.75, 8.5, 0.3),
      obst('bedroom-shoe', 'shoe', 6.2, 7.5, 1.2),
      obst('bedroom-sock', 'sock', 8.8, 7.4, 0.4),
    ],
    zones: [
      { id: 'nogo-pet-bowls', kind: 'noGo', rect: { x: 0.15, y: 6.0, w: 1.0, h: 0.8 } },
      { id: 'nomop-carpet', kind: 'noMop', rect: { x: 6.8, y: 1.15, w: 2.8, h: 2.6 } },
    ],
    rugs: [
      { id: 'play-carpet', rect: { x: 6.9, y: 1.25, w: 2.6, h: 2.4 }, floor: 'carpet', color: '#b9a48c' },
      { id: 'cafe-rug', rect: { x: 0.3, y: 0.5, w: 2.6, h: 2.2 }, floor: 'rug', color: '#6d4c5a' },
    ],
    // Stairwell in the office NE corner; open (no railing) on its west and south edges.
    cliffs: [{ id: 'stairwell', rect: { x: 10.9, y: 6.9, w: 1.0, h: 2.0 } }],
    dirtPatches: [
      { kind: 'crumbs', x: 1.6, y: 1.6, radius: 0.7, amount: 6 },
      { kind: 'crumbs', x: 4.4, y: 1.6, radius: 0.5, amount: 5 },
      { kind: 'crumbs', x: 3.2, y: 3.7, radius: 0.5, amount: 4 },
      { kind: 'crumbs', x: 2.0, y: 7.9, radius: 0.4, amount: 4 },
      { kind: 'liquid', x: 2.9, y: 7.6, radius: 0.25, amount: 40 },
      { kind: 'hair', x: 7.5, y: 6.4, radius: 0.5, amount: 1.5 },
      { kind: 'hair', x: 10.4, y: 6.4, radius: 0.4, amount: 1.0 },
      { kind: 'stain', x: 8.6, y: 3.0, radius: 0.15, amount: 0.6 },
      { kind: 'dust', x: 5.0, y: 8.4, radius: 0.45, amount: 6 },
      { kind: 'dust', x: 11.3, y: 4.2, radius: 0.4, amount: 4 },
      { kind: 'dust', x: 11.2, y: 0.8, radius: 0.4, amount: 5 },
    ],
    // Playroom, against the west wall (face x = 6.06), facing -x.
    dock: { x: 6.535, y: 4.0, theta: Math.PI },
  };
}
