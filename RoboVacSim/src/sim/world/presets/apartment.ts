import type { HouseLayout } from '../types';
import { BED_FOOT, FACING, WallSet, chairsAround, furn, obst, p } from './helpers';

/**
 * Simple apartment, 9 x 7 m (wall centerlines). Open-plan kitchen + living room on the west side,
 * a short entrance hallway in the middle of the east side with the bathroom to the south and the
 * bedroom to the north.
 *
 *   y=7 +----------------------+--------------+
 *       |  living (hardwood)   |   bedroom    |
 *       |  sofa / TV / dock    |              |
 *  y=3.2|                      +---door-------+
 *       |                     door  hallway   |
 *  y=2.6|- - - - - - - - - - - +------door----+ y=2.0
 *       |  kitchen (tile)      |   bathroom   |
 *   y=0 +----------------------+--------------+
 *      x=0                   x=5.6           x=9
 */
export function buildApartment(): HouseLayout {
  const ws = new WallSet()
    .perimeter(0, 0, 9, 7)
    .int('wall-core', p(5.6, 0), p(5.6, 7), [{ at: 2.6, width: 0.9, id: 'door-living-hall' }])
    .int('wall-bath', p(5.6, 2.0), p(9, 2.0), [{ at: 1.6, width: 0.8, id: 'door-bathroom' }])
    .int('wall-bedroom', p(5.6, 3.2), p(9, 3.2), [{ at: 0.8, width: 0.9, id: 'door-bedroom' }]);

  const diningTable = { x: 3.6, y: 1.85, w: 1.2, d: 0.8 };

  return {
    id: 'apartment',
    name: 'Simple apartment',
    description: 'One-bedroom apartment (~63 m²): open living room + kitchen, bedroom, bathroom and a short hallway.',
    bounds: { x: -0.1, y: -0.1, w: 9.2, h: 7.2 },
    rooms: [
      { id: 'kitchen', name: 'Kitchen', kind: 'kitchen', rects: [{ x: 0, y: 0, w: 5.6, h: 2.6 }], floor: 'tile' },
      { id: 'living', name: 'Living room', kind: 'living', rects: [{ x: 0, y: 2.6, w: 5.6, h: 4.4 }], floor: 'hardwood' },
      { id: 'bathroom', name: 'Bathroom', kind: 'bathroom', rects: [{ x: 5.6, y: 0, w: 3.4, h: 2.0 }], floor: 'tile' },
      { id: 'hallway', name: 'Hallway', kind: 'hallway', rects: [{ x: 5.6, y: 2.0, w: 3.4, h: 1.2 }], floor: 'hardwood' },
      { id: 'bedroom', name: 'Bedroom', kind: 'bedroom', rects: [{ x: 5.6, y: 3.2, w: 3.4, h: 3.8 }], floor: 'hardwood' },
    ],
    walls: ws.walls,
    doors: ws.doors,
    furniture: [
      // Kitchen: fridge + counter run with stove along the south wall, small dining table.
      furn('kitchen-fridge', 'fridge', 0.51, 0.47, FACING.posY),
      furn('kitchen-counter-main', 'kitchenCounter', 2.17, 0.42, FACING.posY, { w: 2.5 }),
      furn('kitchen-stove', 'stove', 3.82, 0.43, FACING.posY),
      furn('kitchen-counter-side', 'kitchenCounter', 4.57, 0.42, FACING.posY, { w: 0.7 }),
      furn('kitchen-plant', 'plant', 5.2, 0.45, 0, { w: 0.45, d: 0.45, h: 1.0 }),
      furn('dining-table', 'diningTable', diningTable.x, diningTable.y, 0, { w: diningTable.w, d: diningTable.d }),
      ...chairsAround('dining-chair', diningTable, { perSide: 2, ends: false }),
      // Living room.
      furn('living-tv-stand', 'tvStand', 2.6, 6.68, FACING.negY),
      furn('living-sofa', 'sofa', 2.6, 4.0, FACING.posY),
      furn('living-coffee-table', 'coffeeTable', 2.6, 5.2, 0),
      furn('living-armchair', 'armchair', 4.5, 5.2, FACING.negX),
      furn('living-floor-lamp', 'floorLamp', 0.4, 6.6, 0),
      furn('living-bookshelf', 'bookshelf', 0.285, 4.7, FACING.posX),
      furn('living-plant', 'plant', 5.15, 6.55, 0),
      // Bathroom.
      furn('bath-tub', 'bathtub', 8.04, 0.485, 0),
      furn('bath-toilet', 'toilet', 6.01, 0.6, FACING.posX),
      furn('bath-vanity', 'vanity', 6.8, 0.36, FACING.posY, { w: 0.7 }),
      // Bedroom.
      furn('bedroom-bed', 'bed', 7.6, 5.84, BED_FOOT.negY),
      furn('bedroom-nightstand-left', 'nightstand', 6.5, 6.69, FACING.negY),
      furn('bedroom-nightstand-right', 'nightstand', 8.64, 6.69, FACING.negY),
      furn('bedroom-wardrobe', 'wardrobe', 8.0, 3.57, FACING.posY),
      furn('bedroom-dresser', 'dresser', 5.92, 4.6, FACING.posX),
    ],
    obstacles: [
      obst('hall-shoe-1', 'shoe', 8.55, 2.95, 0),
      obst('hall-shoe-2', 'shoe', 8.55, 2.8, 0.15),
      obst('bedroom-sock', 'sock', 7.0, 4.3, 0.6),
    ],
    zones: [],
    rugs: [
      { id: 'living-rug', rect: { x: 1.5, y: 4.6, w: 2.2, h: 1.7 }, floor: 'rug', color: '#8a6a5c' },
      { id: 'bath-mat', rect: { x: 7.3, y: 0.95, w: 0.9, h: 0.5 }, floor: 'rug', color: '#9fb8c4' },
      { id: 'hall-doormat', rect: { x: 8.3, y: 2.2, w: 0.55, h: 0.8 }, floor: 'rug', color: '#5a4b3c' },
    ],
    cliffs: [],
    dirtPatches: [
      { kind: 'crumbs', x: 3.6, y: 1.85, radius: 0.55, amount: 6 },
      { kind: 'crumbs', x: 2.2, y: 0.95, radius: 0.4, amount: 4 },
      { kind: 'liquid', x: 1.4, y: 1.3, radius: 0.25, amount: 40 },
      { kind: 'hair', x: 6.6, y: 1.2, radius: 0.45, amount: 2 },
      { kind: 'hair', x: 7.6, y: 4.4, radius: 0.6, amount: 1.5 },
      { kind: 'stain', x: 1.0, y: 5.8, radius: 0.15, amount: 0.7 },
      { kind: 'stain', x: 6.9, y: 2.6, radius: 0.12, amount: 0.5 },
      { kind: 'dust', x: 8.4, y: 2.6, radius: 0.5, amount: 5 },
      { kind: 'dust', x: 0.6, y: 3.3, radius: 0.4, amount: 3 },
    ],
    // Against the core wall in the living room, tower back 1.5 cm from the wall face (x = 5.54).
    dock: { x: 5.065, y: 4.0, theta: 0 },
  };
}
