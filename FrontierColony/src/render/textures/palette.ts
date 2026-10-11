/** Shared colour palette: a warm, slightly desaturated "storybook" look with soft cool shadows. */
import type { RGB } from '../util/color';

export interface Ramp {
  dark: RGB;
  mid: RGB;
  light: RGB;
}

export const GRASS: Ramp = { dark: [96, 146, 76], mid: [126, 174, 90], light: [158, 200, 106] };
export const GRASS_BLADE_DARK: RGB = [66, 116, 62];
export const GRASS_BLADE_LIGHT: RGB = [190, 224, 132];
export const FOREST_FLOOR: Ramp = { dark: [62, 100, 62], mid: [82, 126, 70], light: [104, 148, 82] };
export const SAND: Ramp = { dark: [216, 196, 148], mid: [234, 218, 172], light: [246, 235, 198] };
export const SAND_RIPPLE: RGB = [200, 176, 126];
export const HILL_GROUND: Ramp = { dark: [126, 112, 90], mid: [152, 138, 110], light: [176, 164, 134] };
export const ROCK_GROUND: Ramp = { dark: [100, 98, 100], mid: [126, 124, 122], light: [150, 148, 144] };
export const SOIL: Ramp = { dark: [112, 82, 58], mid: [150, 114, 80], light: [178, 142, 102] };
export const CLIFF_ROCK: Ramp = { dark: [88, 86, 90], mid: [122, 118, 118], light: [152, 148, 142] };
export const CLIFF_SAND: Ramp = { dark: [190, 164, 120], mid: [214, 190, 142], light: [232, 212, 166] };

export const FLOWER_COLORS: RGB[] = [
  [252, 250, 242],
  [250, 222, 92],
  [242, 150, 172],
  [186, 160, 232],
  [248, 168, 90],
];

/** Tints (multiplied over the near-white water texture) from the shore out to the deep. */
export const WATER_SHORE: RGB = [118, 208, 214];
export const WATER_SHALLOW: RGB = [86, 178, 206];
export const WATER_MID: RGB = [58, 138, 190];
export const WATER_DEEP: RGB = [38, 94, 158];

export const TREE = {
  oakDark: [38, 92, 58] as RGB,
  oakMid: [64, 134, 66] as RGB,
  oakLight: [112, 178, 80] as RGB,
  oakHi: [166, 216, 104] as RGB,
  pineDark: [28, 76, 62] as RGB,
  pineMid: [46, 110, 78] as RGB,
  pineLight: [84, 150, 100] as RGB,
  trunk: [104, 74, 52] as RGB,
  trunkDark: [70, 48, 36] as RGB,
};

export const ROCK = {
  dark: [88, 86, 92] as RGB,
  mid: [140, 136, 134] as RGB,
  light: [190, 184, 172] as RGB,
};

export const SNOW = {
  light: [250, 252, 255] as RGB,
  mid: [226, 236, 248] as RGB,
  shade: [176, 196, 226] as RGB,
};

/** Soft cool shadow colour. */
export const SHADOW: RGB = [28, 36, 58];
