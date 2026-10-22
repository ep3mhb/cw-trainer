# Testing

Four ways in, cheapest first.

## 0. Before a release: Safari

The automated tests run Chromium. Safari is a different engine and has
twice bitten us in the same day (21 September 2026): unanchored gain ramps
that went silent, and a repainting page that hung the browser. Before any
release with a visual or audio change, open it in Safari on the Mac and on
the iPhone and use it for a minute — tune, key, switch tabs. That minute is
cheaper than the members finding it.

## 1. Automated

```
npm run lint       # typecheck, no emit
npm test           # 451 unit tests across the client and server, ~9 s
npm run coverage   # the same, with thresholds enforced
npm run test:e2e   # production build + 53 checks in a real browser
```

`npm run test:e2e` needs a browser once:

```
npx playwright install chromium
```

If you would rather not download one, point it at a browser you already have:

```
PW_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:e2e
```

The e2e test covers what unit tests cannot: audio refusing to start before a
gesture and starting after one, IndexedDB surviving a reload, the service
worker serving the app with the network cut, and an export → wipe → re-import
round trip. It builds first, so it always tests the real bundle.

## 2. By hand, in development

```
npm run dev
```

Open the URL it prints. Hot reload is on, so edits to `src/` appear
immediately.

**The service worker is deliberately off in development** — see
`registerServiceWorker()` in `src/main.ts`. A cache-first worker during
development serves you yesterday's bundle and wastes an afternoon. Offline and
install behaviour must be tested against a build, as below.

A five-minute pass that touches everything:

1. **Receive** → *Enable sound* → *Start session*. Two characters (K and M) at
   18 WPM characters, 8 WPM effective. Type what you copy, press Enter.
2. Drop a character on purpose. The marked line should show that one character
   wrong and the rest right — not everything after it wrong.
3. **Progress**. The session, the per-character table and the confusion matrix
   should all be there. Switch tabs mid-session and come back: the work counts.
4. **Send** → read the latency panel before anything else (next section).
5. **Settings** → *Test — send V V V*, then drag the pitch and envelope sliders
   while it plays.
6. **Settings** → *Export everything*, then *Delete all local data*, then
   *Import a file*. Everything should come back.

## 3. With your own key or paddle

The default key map is VBand's: <kbd>[</kbd> is the dit paddle, <kbd>]</kbd> is
the dah. A paddle adaptor already set up for VBand — including one going
through a Karabiner rule that turns its mouse buttons into brackets — works
here with nothing to configure. Mouse buttons are also accepted directly, so
an adaptor presenting itself as a mouse works even with no Karabiner rule at
all.

1. **Send** → *Arm the key*, then click the keying pad so it has focus.
2. Pick *Iambic paddle* or *Straight key*, and mode A or B.
3. Key something. The lamp follows the keying.
4. *Analyse*. You get the decode, your speed, your dah:dit ratio, your
   consistency, and a bar per element against the ideal length.

**Check the latency panel first, then press "Measure for real".** The figures
the browser reports about itself turned out to disagree by a factor of twelve
between Safari, Chrome and Firefox on one machine, so the loopback measurement
is the one to believe. Anything much over 60 ms and sending practice is not
worth doing — you will be training against a delay that is not
there on the air. Bluetooth headphones add 100–200 ms and the panel says so
outright. Use wired output or the built-in speakers.

If nothing keys at all:

| Symptom | Usual cause |
| --- | --- |
| No lamp, no tone | The pad does not have focus — click it |
| Nothing from the paddle, but <kbd>[</kbd> on the keyboard works | Karabiner: *Modify events* not ticked for the adaptor under Devices |
| Right paddle opens a context menu | Not armed — arming suppresses the menu |
| Dit and dah swapped | Swap them in Settings → *Set dit* / *Set dah*, or swap the key codes in the Karabiner rule |

Settings → *Set dit* / *Set dah* / *Set straight key* captures whatever you
press next, keyboard or mouse button, so an adaptor sending something unusual
can be mapped without editing anything.

## 4. Offline and installing it

Offline needs a build, because the service worker only registers in one:

```
npm run build && npm run preview
```

Then, in the browser:

1. Load the page once and let it settle.
2. Turn off Wi-Fi, or tick *Offline* in the browser's Network devtools.
3. Reload. The whole app should come up and a full session should run.
4. Still offline, check **Progress** — history comes from IndexedDB and is
   unaffected.

To install it: Chrome shows an install icon in the address bar; on iOS Safari
use *Share → Add to Home Screen*. It then opens without browser chrome and
still works with no connection.

## What the project's acceptance criteria need

| # | Criterion | How it is tested today |
| --- | --- | --- |
| 1 | Element timing accurate and stable | `npm test` — asserts "PARIS " takes exactly 60/WPM seconds at 5, 15 and 25 WPM |
| 2 | No key clicks | By ear, Settings → *Test*, dragging the envelope slider. A spectrum check is still to be done |
| 3 | Timing not driven by setTimeout | Code review. `grep -rn "setTimeout\|setInterval" src/` — the hits are wake-ups and UI delays, never element lengths |
| 4 | Sending latency acceptable | The Send tab's **"Measure for real"** loopback probe. The browser-reported figures next to it proved unreliable (see `ROADMAP.md`), so they no longer count as evidence. Loopback figures wanted for Safari, Chrome, Firefox, iOS and Windows |
| 5 | Decoder accuracy | `npm test` — 100% on known-good sending at 12 and 20 WPM |
| 6 | Robot QSO completes | Not built yet — see `ROADMAP.md` |
| 7 | Works offline | `npm run test:e2e`, and section 4 above by hand |
| 8 | Export and re-import | `npm run test:e2e`, and section 2 step 6 by hand |

Criterion 4 is the one that cannot be automated away: it is a property of the
member's own machine, browser and audio path. The panel does the measuring;
someone has to run it on each browser members use, with a real
paddle, and write the numbers down — **with the browser version**, since
`outputLatency` support can arrive in a point release. macOS Safari 27.0 is
done (15.6 ms); iOS, Chrome, Firefox and Windows are not.


## Two browsers on the band (Phase 2)

`tests/e2e/band.mjs` is not part of `npm run test:e2e`, because it needs the
signalling server running against PostgreSQL. Locally:

```
# in server/: DATABASE_URL=... TURN_SECRET=x TURN_URI=turn:localhost:3478 \
#   ICE_POLICY=all APP_ORIGIN=http://localhost:4173 ADMIN_CALLSIGN=T3ST node dist/server.js
npm run build && npx vite preview --port 4173 &
SIG_ORIGIN=http://localhost:8080 APP_URL=http://localhost:4173/ npm run test:band
```

`ICE_POLICY=all` because relay-only needs a TURN server. `ADMIN_CALLSIGN=T3ST`
because the test registers (once) and then signs in as that administrator to
confirm a callsign from the page. Against the project's real server it can only
run from the application's own origin, since the server admits no other.

40 checks (21 September 2026): registration and confirmation states, the
admin page confirming a callsign and it showing on the band without a
sign-out, the band scope (labels, drag-to-tune, press-to-land), the data
channel both ways, the receiver's loudspeaker level before and during
keying and after re-tuning, the noise floor following the band-conditions
preset, the key held during the other station's over and released after,
the link line, a report carrying a decoded transcript, the log for both
sides, the log panel and ADIF button.
