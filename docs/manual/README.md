# The user manual

Three PDFs, one source: English, Persian and Arabic. The three `content-<lang>.mjs` files hold the text as
plain data (chapters → sections → blocks); `build.mjs` renders them to HTML
with the panel's own colours, lets Chromium paginate, reads the result back
once to learn which page each heading landed on, and renders again with those
numbers in the contents list. The Morse chart, the Q-code, abbreviation and
prosign tables and the glossary are imported from the application's own data
(`src/data/reference.ts`, `src/core/morse.ts`), so they cannot drift from what
the app sends. The Persian and Arabic files each carry their own translations of those tables.
Arabic is set in Noto Sans Arabic rather than Vazirmatn: Vazirmatn draws Arabic
correctly but with Persian letterforms, which an Arabic reader notices. Arabic
uses Western numerals (0–9), as Gulf technical writing does and because the
figures sit beside Latin values like WPM and 599.

The built PDFs ship with the client at `public/manual/` and are linked from the
Help tab's About panel. They are not precached by the service worker (about
8 MB together); the fetch handler caches them on first open.

## Rebuilding

Needs Node 22 (for `--experimental-strip-types`), Playwright's Chromium and
`pdftotext`/`pdfinfo` (poppler).

```sh
cd docs/manual
npm install            # fonts, pinned in this folder's package.json

# 1. Screenshots — against the local stack (server on :8080, preview on :4173,
#    ADMIN_CALLSIGN=T3ST; see docs/TESTING.md). Writes docs/manual/shots/.
PW_EXECUTABLE=<chromium> node --experimental-strip-types screenshots.mjs
PW_EXECUTABLE=<chromium> node screenshot-log.mjs <email of a member with a logged contact>
PW_EXECUTABLE=<chromium> node exam-offer-shot.mjs      # figure 5
#    Then the crops and the JPEG conversion (needs Pillow):
python3 crops.py

# 2. PDFs
PW_EXECUTABLE=<chromium> node --experimental-strip-types build.mjs en fa ar
cp out/CW-Trainer-User-Manual-EN-*.pdf ../../public/manual/CW-Trainer-User-Manual-EN.pdf
cp out/CW-Trainer-User-Manual-FA-*.pdf ../../public/manual/CW-Trainer-User-Manual-FA.pdf
cp out/CW-Trainer-User-Manual-AR-*.pdf ../../public/manual/CW-Trainer-User-Manual-AR.pdf
```

Bump `VERSION` in both content files when the application version changes;
it is printed on the cover and in the footer. Playwright comes from the
application's own devDependencies, one level up.

The figures are not in the repository (`.gitignore`), so there is no way to
change the text and keep the old pictures: any rebuild retakes all of them,
and that needs the local stack running.

**Figure 6, the certificate**, is taken by sitting the final exam through the
API and decoding the server's own timing stream back into characters — the
same round trip `server/tests/exam.test.ts` uses to prove the stream is
honest. It is the only way a script can sit that exam, because the characters
are never sent to the browser by design. This is why `screenshots.mjs` now
needs `--experimental-strip-types`: it imports `src/core/decoder.ts`. If the
capture fails it says so and sets a non-zero exit code, rather than leaving a
hole to be found in the finished PDF.

**Figure 5, the exam offer**, is taken by `exam-offer-shot.mjs`, run after
`screenshots.mjs` and before `crops.py`. The panel appears only after a
session that genuinely meets the rule, and nothing in the page exposes what
is being sent (`currentAnswer` is a closure variable, deliberately). So the
drill is made *reproducible* rather than readable: `systemRandom()` seeds
mulberry32 from `Math.random()`, so pinning `Math.random` in the page makes
every session generate the identical drill. One throwaway session reads the
text off the marked-copy line, then a second real session is answered
correctly and earns the offer. What is photographed is a true qualifying
session at 100%.

### The local stack needs two things it does not need in production

Both were found the hard way on 11 October 2026, and both make the contact
figures (8, 12, 13, 14, 15, 16, 17) impossible without them:

- **`ICE_POLICY=all` on the signalling server.** The default is `relay`, and a
  local stack has no TURN server in front of it, so the contact sits on
  "connecting" for ever.
- **`--disable-features=WebRtcHideLocalIpsWithMdns`** in the browser launch
  (already in `screenshots.mjs`). Chrome replaces host ICE candidates with
  mDNS `.local` names, which nothing resolves when both browsers are on one
  machine with no mDNS responder.

A full local stack for the figures therefore starts as:

```sh
DATABASE_URL=... TURN_SECRET=x TURN_URI=turn:127.0.0.1:3478 \
  ADMIN_CALLSIGN=T3ST ICE_POLICY=all node server/dist/server.js
```

## Dry-running the build without the stack

The figures need the local stack, but the *layout* does not. Drop grey
placeholder JPEGs named after every `src` into `shots-jpg/` and `build.mjs`
runs as normal: pagination, the contents list, figure numbering and the
cross-references are all exercised. It catches a mis-numbered figure or a
broken chapter reference without a database anywhere near it.

The marker spans (`mrk4d1end`) are rendered in **pass 1 only**. They are 1px
absolutely-positioned white text used to learn which page each heading lands
on, and until 11 October 2026 they survived into the shipped PDFs — 57 of
them in the 0.7.3 English manual — where `pdftotext`, and therefore Google,
read them as text sitting beside every heading. Omitting them from pass 2
cannot move anything, because absolutely-positioned content takes no layout
space; this was confirmed by building both ways and comparing page counts
(56 and 49) and section placements (66) exactly.

## Writing rules

- Control names are given in **bold**, exactly as on screen, in both
  languages — the Persian manual keeps the English labels so a reader can find
  the control.
- Inline markup: `**bold**`, `` `code` `` (LTR, isolated), `<kbd>Key</kbd>`.
- Block types: string (paragraph), `note` (kinds: default, `warn`, `good`),
  `steps`, `ul`, `fig`/`figrow`, `table` (with `mono` column indexes), `pre`
  (lines starting `#` are comments), `dl`, `kv`, `morse`.

## A note on where this can be rebuilt (17 October 2026)

Playwright's Chromium cannot be downloaded on the Mac's Linux VM, so the
figures and the PDFs are built in the cloud container instead, which has
Chromium at `/opt/pw-browsers/chromium` and PostgreSQL 16. The VM has
node, npm, `pdftotext`, `pdfinfo`, python3 and Pillow — only the browser
is missing.

Two things that are easy to get wrong there:

- The signalling server must run with `ICE_POLICY=all`. The live server
  uses `relay`, which needs a TURN server; without one, the two browser
  contexts never connect and every figure from the contact onwards fails.
- `npm run build` cannot run inside the mounted folder — removing the old
  `dist` needs an unlink the mount does not permit. Copy the application
  to a scratch directory outside `mnt/`, symlink `node_modules`, and build
  there.

## The version on the cover is not the release number

The covers and `VERSION` in `content-{en,fa,ar}.mjs` read **0.11.0**, while the
release that carried those PDFs was **0.11.1**. This is deliberate as of
19 October 2026 and is not to be "fixed".

The two numbers mean different things. The cover states **the version of the
application the manual describes**. 0.11.0 is when the last user-visible change
happened — the account moving from On air to Settings (A43). 0.11.1 changed no
behaviour at all; its version moved only because the service worker's cache
name is derived from the precache list, the manuals are deliberately not in
that list, and without a version bump the old PDFs would have survived
`activate` for ever. 0.12.0 (structured data) is invisible to members too.

It diverged by accident rather than by decision — the content was written while
the release was still going to be 0.11.0 — but the result is honest, and
re-labelling costs a full three-language rebuild with every figure retaken for
the sake of a number on a cover.

**The rule, so this stops being accidental:** bump `VERSION` when the manual's
*content* changes to describe a new state of the application, not when it
happens to ship inside a release. A reader comparing the cover to Help → About
may therefore see two different numbers, and that is correct.
