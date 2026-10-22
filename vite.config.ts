import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  base: './',
  // Shown on the Help tab's About panel, so a member reporting a problem can
  // say which build they are on.
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'server/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      /*
       * RFP §11 requires coverage "specifically for the timing engine and the
       * decoder". The whole of src/core is held to it, with one exclusion:
       *
       *  - audio.ts is mostly Web Audio glue whose signal path is verified
       *    by the browser smoke test. Its lifecycle logic is not glue,
       *    though — deciding whether audio is genuinely alive is where a
       *    real bug lived — so that part is tested against a fake context
       *    and the file is no longer excluded outright.
       *
       * src/ui and src/storage/db.ts are likewise browser-only; the logic
       * worth testing in storage is in schema.ts, which is covered.
       */
      include: ['src/core/**', 'src/storage/schema.ts'],
      /*
       * Three files are excluded from the *metric*, not from testing. Each is
       * Web Audio or getUserMedia glue that only a browser can exercise, and
       * in every case the logic worth testing was deliberately pulled out
       * into a pure module that is covered:
       *
       *   audio.ts        -> timing.ts, keyer.ts, and its own lifecycle suite
       *   band-audio.ts   -> band.ts (fading, filter, crashes: 96%)
       *   latency-probe.ts-> onset.ts (the detection that decides the
       *                      measurement: 98%)
       *
       * The browser smoke test covers the glue end to end. Averaging
       * unreachable Web Audio calls into this figure would quietly lower the
       * bar for the timing engine and the decoder, which are the two files
       * the RFP names for coverage.
       */
      exclude: ['src/core/audio.ts', 'src/core/band-audio.ts', 'src/core/latency-probe.ts'],
      thresholds: { lines: 95, functions: 95, branches: 85, statements: 95 },
    },
  },
});
