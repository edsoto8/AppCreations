/** Anything with a dispose() method (geometries, materials, textures, render targets). */
export interface Disposable {
  dispose(): void;
}

/** Tracks GPU resources created by a model so they can all be released in one call. */
export class Disposables {
  private readonly items: Disposable[] = [];

  track<T extends Disposable>(item: T): T {
    this.items.push(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.length = 0;
  }
}
