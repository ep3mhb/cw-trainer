/**
 * Bundle the built application into one self-contained .html file.
 *
 * Why this exists: members are not all developers, and a single
 * file that opens by double-clicking — no server, no Node, no install — is
 * the difference between "try it and tell me what you think" and "set up a
 * toolchain first". It is also the easiest thing to email, or to drop on a
 * web host with no build step at all.
 *
 * Run after `npm run build`:  node scripts/build-single.mjs
 * Or in one step:             npm run build:single
 *
 * The PWA parts (manifest, service worker) are dropped: they need real
 * URLs and an origin, so they belong to the dist/ build, not to this one.
 * Everything else is identical code.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const OUT = join(DIST, 'cw-trainer-standalone.html');

const assets = await readdir(join(DIST, 'assets'));
const jsName = assets.find((f) => f.endsWith('.js'));
const cssName = assets.find((f) => f.endsWith('.css'));
if (jsName === undefined || cssName === undefined) {
  throw new Error('No built assets found. Run `npm run build` first.');
}

const js = await readFile(join(DIST, 'assets', jsName), 'utf8');
const css = await readFile(join(DIST, 'assets', cssName), 'utf8');
const icon = await readFile(join(DIST, 'icon.svg'), 'utf8');
let html = await readFile(join(DIST, 'index.html'), 'utf8');

// A literal </script> inside the bundle would end the inline script early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

html = html
  .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/i, `<script type="module">\n${safeJs}\n</script>`)
  .replace(/<link[^>]*rel="stylesheet"[^>]*>/i, `<style>\n${css}\n</style>`)
  // Needs a real URL and an origin; not meaningful in a single file.
  .replace(/<link[^>]*rel="manifest"[^>]*>\s*/i, '')
  // Inline the tab icon so the file really has no companions.
  .replace(
    /<link[^>]*rel="icon"[^>]*>/i,
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(icon, 'utf8').toString('base64')}">`,
  )
  .replace(/\s*\/\/# sourceMappingURL=[^\n]*/g, '');

// The stylesheet is normally in <head>; after the swap above it sits where
// the <link> was, which is also in <head>. Nothing else to move.
// Nothing may be left pointing at a companion file.
const external = [...html.matchAll(/(?:src|href)="(?!data:)([^"]+)"/g)].map((m) => m[1]);
if (external.length > 0) {
  throw new Error(`Not self-contained — still references: ${external.join(', ')}`);
}

await writeFile(OUT, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`build-single: dist/cw-trainer-standalone.html (${kb} kB, self-contained)`);
