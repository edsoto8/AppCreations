// Packages the production build as a claude.ai Artifact: a page fragment (the host adds the
// <!doctype>/<head>/<body> skeleton) with the CSS inlined, plus one bundled script file.
// Usage: npm run build:artifact  → dist-artifact/index.html + dist-artifact/assets/pocket-pixel.js
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const out = 'dist-artifact';
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
const css = html.match(/href="\.\/(assets\/[^"]+\.css)"/)?.[1];
if (!js || !css) throw new Error('Could not find the built JS/CSS in dist/index.html. Run `npm run build` first.');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });
copyFileSync(join(dist, js), join(out, 'assets', 'pocket-pixel.js'));
const styles = readFileSync(join(dist, css), 'utf8');

const page = `<title>Pocket Pixel 3D</title>
<style>
${styles}
</style>
<div id="app"></div>
<noscript>Pocket Pixel 3D needs JavaScript and WebGL.</noscript>
<script type="module" src="assets/pocket-pixel.js"></script>
`;
writeFileSync(join(out, 'index.html'), page);
console.log(`Wrote ${out}/index.html (${(page.length / 1024).toFixed(1)} KB) and ${out}/assets/pocket-pixel.js`);
