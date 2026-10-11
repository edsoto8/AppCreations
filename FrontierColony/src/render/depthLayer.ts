/**
 * Depth-sorted object layer, split into one band per isometric diagonal (floor of the depth key).
 *
 * Painter's order is bands in order, then zIndex inside a band. Each band is its own render group, so
 * when a settler moves only the (tiny) band it is in is re-sorted and re-batched; the thousands of static
 * trees, rocks and raised tiles in the other bands cost nothing per frame.
 */
import { Container, type Sprite } from 'pixi.js';

export type DepthObject = Container | Sprite;

export class DepthLayer {
  private bands: Container[] = [];
  private readonly root: Container;

  constructor(root: Container) {
    this.root = root;
  }

  /** (Re)create bands for a map of the given size. Existing contents are dropped. */
  setSize(width: number, height: number): void {
    for (const b of this.bands) b.destroy({ children: false });
    this.bands = [];
    const n = width + height + 6;
    for (let i = 0; i < n; i++) {
      const band = new Container({ isRenderGroup: true });
      band.sortableChildren = true;
      this.bands.push(band);
    }
    this.root.addChild(...this.bands);
  }

  private bandFor(z: number): Container {
    const i = Math.min(this.bands.length - 1, Math.max(0, Math.floor(z)));
    return this.bands[i]!;
  }

  /** Put an object (whose zIndex is already set) into its band. */
  place(obj: DepthObject): void {
    const band = this.bandFor(obj.zIndex);
    if (obj.parent !== band) band.addChild(obj);
  }

  /** Set a new depth and move between bands when needed. */
  setDepth(obj: DepthObject, z: number): void {
    if (obj.zIndex !== z) obj.zIndex = z;
    this.place(obj);
  }

  remove(obj: DepthObject): void {
    obj.removeFromParent();
  }
}
