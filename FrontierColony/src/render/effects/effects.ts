/** Gameplay feedback: maps SimEvents (and tile changes) onto particles, floating text and tree falls. */
import type { SimEvent } from '../../sim';
import type { DepthLayer } from '../depthLayer';
import type { Layers } from '../layers';
import type { TextureSet } from '../textures';
import { FellTrees } from './fellTrees';
import { FloatText } from './floatText';
import { Particles } from './particles';

export interface Locator {
  /** World pixel of the centre of a tile (continuous tile coords allowed). */
  tilePx(x: number, y: number): { x: number; y: number };
  /** Footprint centre on the ground and the approximate roof height of a building. */
  building(id: number): { x: number; y: number; height: number; w: number; h: number } | null;
  settler(id: number): { x: number; y: number } | null;
}

export class Effects {
  readonly particles: Particles;
  readonly floats: FloatText;
  readonly fell: FellTrees;
  private readonly loc: Locator;

  constructor(layers: Layers, depth: DepthLayer, tex: TextureSet, loc: Locator) {
    this.particles = new Particles(layers.effects, tex);
    this.floats = new FloatText(layers.labels, tex);
    this.fell = new FellTrees(depth, tex, this.particles);
    this.loc = loc;
  }

  clear(): void {
    this.particles.clear();
    this.floats.clear();
    this.fell.clear();
  }

  update(dt: number): void {
    this.particles.update(dt);
    this.floats.update(dt);
    this.fell.update(dt);
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'resourceGathered': {
          const p = this.loc.tilePx(e.x + 0.5, e.y + 0.5);
          this.floats.resource(p.x, p.y - 30, e.resource, e.amount);
          if (e.resource === 'stone') this.particles.stoneChips(p.x, p.y - 8, 4);
          break;
        }
        case 'resourceProduced': {
          const b = this.loc.building(e.buildingId);
          if (b) this.floats.resource(b.x, b.y - b.height - 6, e.resource, e.amount);
          break;
        }
        case 'constructionWork': {
          const b = this.loc.building(e.buildingId);
          if (b) {
            const rx = (Math.random() - 0.5) * b.w * 30;
            this.particles.sparks(b.x + rx, b.y - b.height * 0.35, 3, 0xffe29a);
            this.particles.dust(b.x + rx, b.y - 4, 0xd9cbb0, 2, 0.45);
          }
          break;
        }
        case 'buildingPlaced': {
          const b = this.loc.building(e.buildingId);
          if (b) this.particles.dust(b.x, b.y, 0xd9cbb0, 7, 0.8);
          break;
        }
        case 'buildingCompleted':
        case 'buildingRepaired': {
          const b = this.loc.building(e.buildingId);
          if (b) this.particles.celebrate(b.x, b.y - b.height * 0.6);
          break;
        }
        case 'buildingRemoved': {
          const b = this.loc.building(e.buildingId);
          if (b) this.particles.dust(b.x, b.y - 6, 0xcdbfa6, 8, 0.9);
          break;
        }
        default:
          break;
      }
    }
  }
}
