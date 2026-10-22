# CW Trainer

Browser-based Morse code (CW) training: the Koch course for
receiving, sending practice with a real key or paddle, a simulated operator to
work, progress tracking with a confusion matrix — and, for signed-in members,
a virtual band where members call CQ, tune across each other's signals and
work each other live, with the contact going into both logs.

The training side runs **entirely in the browser**: no account, no server, no
network traffic after the first load; everything is stored in this browser and
can be exported to a file. Only the "On air" tab talks to the server,
and only once a member signs in. That server is in `server/`.

Built against the *Request for Development — CW Training Web
Application*, dated 17 September 2026, with the amendments recorded since.
Section references below (§3, §4, …) point into it; the project holds the
document and it is not distributed with this repository. Live at
<https://cw.mikroutik.com>; client version in `package.json`, server version
in `server/package.json`.

**The user manuals are not in this repository.** They are built from
`docs/manual/` and are large; read them at
<https://cw.mikroutik.com/manual/CW-Trainer-User-Manual-EN.pdf> (also `-FA`
and `-AR`), or rebuild them with the harness described in
`docs/manual/README.md`. A build without them serves the Help links as 404.

## Just trying it out

`npm run build:single` produces `dist/cw-trainer-standalone.html` — the whole
application in one file, with the JavaScript, CSS and icon inlined. Open it by
double-clicking; there is nothing to install and no server involved. That is
the file to hand to a member who wants to try the trainer rather than work on
it. Verified working in Safari on macOS and in Chromium, including the progress
saving — but a browser can be configured to refuse storage on a `file://` page,
and the app will say so rather than pretend to save.

Offline install (the PWA parts) and the service worker need real URLs, so those
are tested against `npm run preview` rather than the single file.

## Getting started (development)

```
npm install && npm run dev
```

That is the whole local setup. Open the URL it prints.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, production build into `dist/`, generate the service worker |
| `npm run preview` | Serve the production build (needed to test offline and PWA install) |
| `npm test` | Unit tests |
| `npm run coverage` | Unit tests with coverage thresholds |
| `npm run lint` | Typecheck only |

`dist/` is static files. Any web host will serve it — including GitHub Pages and
ordinary web space. There is nothing to configure.

## What is here

| Area | Where | RFP section |
| --- | --- | --- |
| Element timing, PARIS and Farnsworth | `src/core/timing.ts` | §3, §4 |
| Web Audio sidetone engine | `src/core/audio.ts` | §3 |
| Character tables, prosigns, Koch order | `src/core/morse.ts` | §4 |
| Koch progression rule | `src/core/koch.ts` | §4 |
| Lesson generators | `src/core/generators.ts` | §4 |
| Iambic keyer, modes A and B | `src/core/keyer.ts` | §5 |
| Decoder and timing analysis | `src/core/decoder.ts` | §5 |
| Band conditions model and audio chain | `src/core/band.ts`, `band-audio.ts` | §6 |
| Robot QSO state machine | `src/core/qso.ts` | §6 |
| Accuracy and confusion matrix | `src/core/stats.ts` | §4 |
| IndexedDB store, export format | `src/storage/` | §9 |
| Views | `src/ui/` | §4, §5, §9 |
| Member help page and glossary | `src/ui/help.ts`, `src/data/reference.ts` | §12 |
| Offline service worker generator | `scripts/gen-sw.mjs` | §9 |
| The virtual band: dial, reception, scanning | `src/core/tuning.ts` | §7 |
| Live-contact transport: adaptive buffer, never drop | `src/core/link.ts` | §7 |
| Over to over: whose turn it is | `src/core/turn.ts` | §7 |
| Signalling protocol and negotiation (shared with the server) | `src/core/signalling.ts` | §7 |
| Callsign shape, training identifiers, exportability | `src/core/callsign.ts` | §7, §8 |
| ADIF export | `src/core/adif.ts` | §7 |
| The On air tab, account and admin page | `src/ui/band.ts`, `src/ui/admin.ts` | §7, §8 |
| Server: accounts, band hub, TURN credentials, store | `server/` | §7, §8 |

### State of play

Phase 1 is built and in member use. Phase 2 — accounts, callsign registry
and live member-to-member contacts — is built and in member testing on the
server; `docs/ROADMAP.md` records what each version changed and why,
`docs/SERVER-SETUP.md` how the server is run, and `docs/PHASE2-*.md` the
decisions behind it. The member-facing **user manual** — a PDF in English,
Persian and Arabic, with a screenshot of every tab — is built from
`docs/manual/` and shipped with the client at `public/manual/`, linked from
the Help tab.

## Design decisions worth knowing before you change anything

**No UI framework, no runtime dependencies.** The `dependencies` block is
empty; everything shipped to the browser is in `src/`. This is deliberate: the
valuable part of this application is the timing engine, and it is easier to
attract and review outside contributions to plain TypeScript than to a
framework-flavoured version of the same thing. What makes that true is not
the size of `src/` — it has grown past fourteen thousand lines — but that
the core modules are pure functions and classes with no DOM and no audio,
which is why they are fully unit-tested and why a contributor can read the
part they are changing without running the application.

**Timing never comes from a timer.** Every tone is scheduled against
`AudioContext.currentTime`. `setTimeout` and `setInterval` appear only as
wake-ups — the lookahead scheduler in `src/ui/send.ts` calls
`IambicKeyer.tick(audioClockTime)` every 10 ms, and the keyer decides element
boundaries from the clock value it is handed, never from when the tick
happened. A change that makes an element length depend on timer delivery is a
change that will be rejected at acceptance (criterion 3), so please keep this
property.

**Farnsworth is not optional.** Character speed and effective speed are
separate settings everywhere, including in the type of `TimingSettings`. A
student must never be able to learn to count elements.

**The confusion matrix depends on alignment, not indexing.** `alignAnswer` in
`src/core/stats.ts` runs a real edit-distance alignment, so one dropped
character does not mark everything after it wrong. A naive index-by-index
comparison silently corrupts every statistic in the application; there is a
test named for that case.

**Sending latency is measured and reported, not assumed.** `CwAudioEngine.latency()`
reports the buffer, the driver path and this engine's scheduling lead, and the
Send tab adds the measured input-event delay. Bluetooth output shows up here as
a large `outputLatency` and is called out to the student explicitly, because it
cannot be corrected in software.

## Browser support

Current Chrome, Edge, Firefox and Safari on desktop, Safari on iOS and Chrome on
Android.

Known differences:

- **Audio output latency** is not reported by every browser. Where it is
  missing the latency panel falls back to an estimate from the buffer size and
  labels it `(est)`. This is decided by the value being absent, not by
  detecting the browser — Safari 27.0 on macOS does report it (measured:
  8.9 ms), so do not assume otherwise from an older note.
- **Audio needs a user gesture** in every browser. The interface has an explicit
  "Enable sound" control rather than failing silently.
- **Private browsing windows** may refuse IndexedDB. The app reports this
  instead of appearing to work and losing everything.

## Your data

Stored in this browser only, under IndexedDB database `cw-trainer`. Settings,
progress, session history, raw attempts and sending runs. Raw attempts are kept
for 30 days and then rolled up into per-character totals, so the progress charts
stay quick.

Settings → **Export everything** writes one JSON file with the whole history.
That file is the Phase 2 migration format: `src/storage/schema.ts` is the
contract, it is versioned, and Phase 2 is expected to read every version it has
ever written. Settings → **Delete all local data** removes everything.

## Licence

Apache License 2.0. Copyright 2026 Mohammad Bahrololoum. See `LICENSE`.

You may use, modify and redistribute this, including commercially, provided
you keep the copyright notice and state what you changed. The licence includes
an explicit patent grant, which is the main thing it adds over MIT.

Contributions are accepted under the same licence, certified by a
`Signed-off-by` line on each commit — see `CONTRIBUTING.md`.
