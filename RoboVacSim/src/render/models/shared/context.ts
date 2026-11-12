import { Disposables } from './Disposables';
import { MaterialLibrary } from './materials';
import { PartBuilder } from './PartBuilder';
import { resolveQuality, type ModelQuality, type QualitySettings } from './quality';
import { TextureLibrary } from './textures';

/** Everything a part builder needs: quality budget, per-instance materials/textures, disposal tracking. */
export class BuildContext {
  constructor(
    readonly q: QualitySettings,
    readonly mats: MaterialLibrary,
    readonly tex: TextureLibrary,
    readonly track: Disposables,
  ) {}

  builder(): PartBuilder {
    return new PartBuilder(this.track);
  }
}

export function createBuildContext(quality: ModelQuality | undefined): BuildContext {
  const q = resolveQuality(quality);
  const track = new Disposables();
  const tex = new TextureLibrary(q.texSize, track);
  const mats = new MaterialLibrary(tex, track);
  return new BuildContext(q, mats, tex, track);
}
