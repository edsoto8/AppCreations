import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

/** Bundled fonts (SIL Open Font License, see public/fonts/LICENSE.md) so renders are identical offline. */
const faces: Array<[string, string, string]> = [
  ['Inter', 'Inter-Regular.otf', '400'],
  ['Inter', 'Inter-Medium.otf', '500'],
  ['Inter', 'Inter-SemiBold.otf', '600'],
  ['Inter', 'Inter-Bold.otf', '700'],
  ['Inter', 'Inter-ExtraBold.otf', '800'],
  ['JetBrains Mono', 'JetBrainsMono-Medium.ttf', '500'],
  ['JetBrains Mono', 'JetBrainsMono-Bold.ttf', '700'],
];

export const fontsReady = Promise.all(
  faces.map(([family, file, weight]) => loadFont({ family, url: staticFile(`fonts/${file}`), weight })),
);
