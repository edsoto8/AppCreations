// Render review stills: node scripts/stills.mjs <outDir> <frame...> [--browser=<path>] [--scale=0.5]
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split('=').slice(1).join('=');
const rest = args.filter((a) => !a.startsWith('--'));
const outDir = rest[0];
const frames = rest.slice(1).map(Number);
const browserExecutable = opt('browser', '') || null;
const scale = Number(opt('scale', '0.5'));

const serveUrl = await bundle({ entryPoint: path.resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id: 'ATMExplainer', browserExecutable });
for (const frame of frames) {
  const output = path.join(outDir, `f${String(frame).padStart(4, '0')}.png`);
  await renderStill({ serveUrl, composition, frame, output, scale, browserExecutable });
  console.log('rendered', output);
}
