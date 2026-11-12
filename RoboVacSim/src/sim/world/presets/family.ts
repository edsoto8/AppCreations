import type { HouseLayout } from '../types';
import { BED_FOOT, FACING, WallSet, chairsAround, furn, obst, p } from './helpers';

/**
 * Family home, 15 x 11 m (wall centerlines).
 *
 *  y=11 +---------+--------+-----------+-------------+
 *       | bed 1   |  bath  |  bed 2    |   office    |
 *       | (wood)  | (tile) | (carpet)  |   (wood)    |
 *  y=6.32+--d------+--d-----+---d-------+--d----------+
 *       | hallway (1.0 m clear)          | STAIRS DOWN |  <- cliff, open toward the hallway
 *  y=5.2 +--d------------------+------d--+---+---------+
 *       | living      dining   | kitchen     | laundry |
 *       | (wood, rug) (rug)    | (tile)      +---d-----+ y=3.2
 *       |                    passage  island          |
 *   y=0 +----------------------+-----------------------+
 *      x=0                   x=9.6                    x=15
 */
export function buildFamily(): HouseLayout {
  const ws = new WallSet()
    .perimeter(0, 0, 15, 11)
    // Hallway walls.
    .int('wall-hall-south', p(0, 5.2), p(15, 5.2), [
      { at: 1.4, width: 1.0, id: 'door-living' },
      { at: 10.6, width: 0.9, id: 'door-kitchen' },
    ])
    .int('wall-hall-north', p(0, 6.32), p(15, 6.32), [
      { at: 3.8, width: 0.9, id: 'door-bedroom-1' },
      { at: 5.9, width: 0.8, id: 'door-bathroom' },
      { at: 8.0, width: 0.9, id: 'door-bedroom-2' },
      { at: 11.8, width: 0.9, id: 'door-office' },
    ])
    // North wing partitions.
    .int('wall-bed1-bath', p(4.6, 6.32), p(4.6, 11))
    .int('wall-bath-bed2', p(7.2, 6.32), p(7.2, 11))
    .int('wall-bed2-office', p(11.0, 6.32), p(11.0, 11))
    // South wing: dining | kitchen with a wide open passage, laundry corner.
    .int('wall-dining-kitchen', p(9.6, 0), p(9.6, 5.2), [{ at: 2.2, width: 1.6, door: false }])
    .int('wall-laundry-west', p(12.8, 3.2), p(12.8, 5.2), [{ at: 1.0, width: 0.8, id: 'door-laundry' }])
    .int('wall-laundry-south', p(12.8, 3.2), p(15, 3.2));

  const diningTable = { x: 8.0, y: 2.6, w: 1.6, d: 0.9, rotated: true };

  return {
    id: 'family',
    name: 'Family home',
    description:
      'Two-bedroom family home (~165 m²) with living + dining, kitchen with island, laundry, office, bathroom and a hallway ending in an open stairwell.',
    bounds: { x: -0.1, y: -0.1, w: 15.2, h: 11.2 },
    rooms: [
      { id: 'living', name: 'Living room', kind: 'living', rects: [{ x: 0, y: 0, w: 6.4, h: 5.2 }], floor: 'hardwood' },
      { id: 'dining', name: 'Dining area', kind: 'dining', rects: [{ x: 6.4, y: 0, w: 3.2, h: 5.2 }], floor: 'hardwood' },
      {
        id: 'kitchen',
        name: 'Kitchen',
        kind: 'kitchen',
        rects: [
          { x: 9.6, y: 0, w: 5.4, h: 3.2 },
          { x: 9.6, y: 3.2, w: 3.2, h: 2.0 },
        ],
        floor: 'tile',
      },
      { id: 'laundry', name: 'Laundry', kind: 'laundry', rects: [{ x: 12.8, y: 3.2, w: 2.2, h: 2.0 }], floor: 'tile' },
      { id: 'hallway', name: 'Hallway', kind: 'hallway', rects: [{ x: 0, y: 5.2, w: 15, h: 1.12 }], floor: 'hardwood' },
      { id: 'bedroom-1', name: 'Main bedroom', kind: 'bedroom', rects: [{ x: 0, y: 6.32, w: 4.6, h: 4.68 }], floor: 'hardwood' },
      { id: 'bathroom', name: 'Bathroom', kind: 'bathroom', rects: [{ x: 4.6, y: 6.32, w: 2.6, h: 4.68 }], floor: 'tile' },
      { id: 'bedroom-2', name: 'Kids bedroom', kind: 'bedroom', rects: [{ x: 7.2, y: 6.32, w: 3.8, h: 4.68 }], floor: 'carpet' },
      { id: 'office', name: 'Office', kind: 'office', rects: [{ x: 11.0, y: 6.32, w: 4.0, h: 4.68 }], floor: 'hardwood' },
    ],
    walls: ws.walls,
    doors: ws.doors,
    furniture: [
      // Living room.
      furn('living-tv-stand', 'tvStand', 3.0, 0.32, FACING.posY),
      furn('living-sofa', 'sofa', 3.0, 3.4, FACING.negY, { w: 2.2 }),
      furn('living-coffee-table', 'coffeeTable', 3.0, 2.1, 0),
      furn('living-armchair-west', 'armchair', 1.0, 2.0, FACING.posX),
      furn('living-armchair-east', 'armchair', 5.0, 2.0, FACING.negX, { color: '#6f7f6a' }),
      furn('living-floor-lamp', 'floorLamp', 0.45, 3.0, 0),
      furn('living-bookshelf', 'bookshelf', 0.285, 4.2, FACING.posX),
      furn('living-plant', 'plant', 0.45, 0.45, 0),
      furn('living-plant-2', 'plant', 5.9, 0.45, 0, { w: 0.45, d: 0.45, h: 1.0 }),
      // Dining.
      furn('dining-table', 'diningTable', diningTable.x, diningTable.y, Math.PI / 2, { w: 1.6, d: 0.9 }),
      ...chairsAround('dining-chair', diningTable, { perSide: 2, ends: true }),
      furn('dining-sideboard', 'sideboard', 8.0, 0.335, FACING.posY),
      furn('dining-plant', 'plant', 9.15, 4.7, 0),
      // Kitchen.
      furn('kitchen-fridge', 'fridge', 10.07, 0.47, FACING.posY),
      furn('kitchen-counter-south', 'kitchenCounter', 11.49, 0.42, FACING.posY, { w: 2.0 }),
      furn('kitchen-stove', 'stove', 12.89, 0.43, FACING.posY),
      furn('kitchen-counter-corner', 'kitchenCounter', 14.09, 0.42, FACING.posY, { w: 1.6 }),
      furn('kitchen-counter-east', 'kitchenCounter', 14.58, 1.76, FACING.negX, { w: 1.9 }),
      furn('kitchen-island', 'kitchenIsland', 12.0, 2.3, FACING.posY),
      furn('kitchen-stool-1', 'barStool', 11.5, 3.05, FACING.negY),
      furn('kitchen-stool-2', 'barStool', 12.0, 3.05, FACING.negY),
      furn('kitchen-stool-3', 'barStool', 12.5, 3.05, FACING.negY),
      // Laundry.
      furn('laundry-washer', 'washingMachine', 13.95, 4.83, FACING.negY),
      furn('laundry-dryer', 'washingMachine', 14.58, 4.83, FACING.negY),
      // Main bedroom.
      furn('bed1-bed', 'bed', 2.1, 9.84, BED_FOOT.negY, { d: 1.8 }),
      furn('bed1-nightstand-left', 'nightstand', 0.85, 10.69, FACING.negY),
      furn('bed1-nightstand-right', 'nightstand', 3.35, 10.69, FACING.negY),
      furn('bed1-wardrobe', 'wardrobe', 0.41, 7.4, FACING.posX),
      furn('bed1-dresser', 'dresser', 2.0, 6.64, FACING.posY),
      furn('bed1-plant', 'plant', 4.2, 10.6, 0),
      // Bathroom.
      furn('bath-tub', 'bathtub', 5.52, 10.515, 0),
      furn('bath-toilet', 'toilet', 6.79, 8.6, FACING.negX),
      furn('bath-vanity', 'vanity', 4.92, 8.2, FACING.posX, { w: 1.2 }),
      // Kids bedroom.
      furn('bed2-bed', 'bed', 9.1, 9.89, BED_FOOT.negY, { w: 2.0, d: 1.4, color: '#c9d6e3' }),
      furn('bed2-nightstand', 'nightstand', 8.05, 10.69, FACING.negY, { color: '#e8e2d6' }),
      furn('bed2-desk', 'desk', 10.63, 7.6, FACING.negX, { w: 1.2, d: 0.6 }),
      furn('bed2-desk-chair', 'chair', 10.13, 7.6, FACING.posX, { color: '#d9d2c4' }),
      furn('bed2-wardrobe', 'wardrobe', 7.57, 9.3, FACING.posX, { w: 1.4 }),
      furn('bed2-bookshelf', 'bookshelf', 9.5, 6.565, FACING.posY, { color: '#e8e2d6' }),
      // Office.
      furn('office-desk', 'desk', 13.0, 10.54, FACING.negY),
      furn('office-chair', 'officeChair', 13.0, 9.8, FACING.posY),
      furn('office-bookshelf-1', 'bookshelf', 14.72, 8.0, FACING.negX),
      furn('office-bookshelf-2', 'bookshelf', 14.72, 9.0, FACING.negX),
      furn('office-armchair', 'armchair', 11.55, 10.35, FACING.posX),
      furn('office-floor-lamp', 'floorLamp', 11.35, 9.55, 0),
      furn('office-plant', 'plant', 14.55, 6.75, 0),
    ],
    obstacles: [
      obst('hall-shoe-1', 'shoe', 0.3, 5.8, Math.PI / 2),
      obst('hall-shoe-2', 'shoe', 0.46, 5.78, Math.PI / 2 + 0.12),
      obst('kitchen-pet-bowl', 'petBowl', 9.95, 4.8),
      obst('laundry-basket', 'cylinder', 14.5, 3.65, 0, { w: 0.4, d: 0.4, h: 0.5 }),
      obst('bed1-sock', 'sock', 3.6, 8.2, 0.8),
      obst('bed2-toy-1', 'toy', 8.6, 7.6, 0.3),
      obst('bed2-toy-2', 'toy', 9.0, 7.95, 0.9, { w: 0.12, d: 0.12, h: 0.12 }),
    ],
    zones: [],
    rugs: [
      { id: 'living-rug', rect: { x: 1.6, y: 1.2, w: 2.8, h: 1.6 }, floor: 'rug', color: '#7d5a4f' },
      { id: 'dining-rug', rect: { x: 6.9, y: 1.1, w: 2.2, h: 3.0 }, floor: 'rug', color: '#4f6475' },
      { id: 'bath-mat', rect: { x: 4.9, y: 9.55, w: 1.1, h: 0.5 }, floor: 'rug', color: '#a9c2cc' },
      { id: 'hall-doormat', rect: { x: 0.15, y: 5.35, w: 0.6, h: 0.82 }, floor: 'rug', color: '#5a4b3c' },
    ],
    // Stairwell going down at the east end of the hallway (between the hallway wall faces). The
    // west edge (x = 12.5) faces the hallway and has no railing.
    cliffs: [{ id: 'stairwell', rect: { x: 12.5, y: 5.26, w: 2.4, h: 1.0 } }],
    dirtPatches: [
      { kind: 'crumbs', x: 8.0, y: 2.6, radius: 0.7, amount: 5 },
      { kind: 'crumbs', x: 11.5, y: 1.0, radius: 0.45, amount: 4 },
      { kind: 'crumbs', x: 12.0, y: 3.25, radius: 0.4, amount: 3 },
      { kind: 'liquid', x: 13.4, y: 1.25, radius: 0.3, amount: 35 },
      { kind: 'hair', x: 5.8, y: 9.2, radius: 0.5, amount: 2 },
      { kind: 'hair', x: 2.1, y: 8.4, radius: 0.6, amount: 1.5 },
      { kind: 'hair', x: 9.0, y: 8.5, radius: 0.5, amount: 1.2 },
      { kind: 'stain', x: 2.2, y: 1.6, radius: 0.15, amount: 0.6 },
      { kind: 'stain', x: 8.9, y: 1.5, radius: 0.12, amount: 0.5 },
      { kind: 'dust', x: 0.7, y: 5.76, radius: 0.5, amount: 6 },
      { kind: 'dust', x: 13.0, y: 8.0, radius: 0.5, amount: 2 },
    ],
    // Living room, against the hallway wall (face y = 5.14), facing +y.
    dock: { x: 5.6, y: 4.665, theta: Math.PI / 2 },
  };
}
