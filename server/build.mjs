// Bundle the server into one file. The client modules it shares —
// src/core/*.ts (the whole folder is shipped by deploy.sh) — use extensionless imports
// that Vite resolves and Node will not, so bundling is what lets the protocol
// have exactly one definition for both ends of the wire.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.js',
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
  define: { __SERVER_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: '// CW Trainer signalling server — built file, do not edit. Source: server/src/.' },
});
console.log(`built dist/server.js (v${pkg.version})`);
