# The two-browser test — Firefox and Safari

RFD item A5, and the last gap in the RFD's own list. It is a **manual**
procedure and that is not laziness: Playwright's Firefox and WebKit builds
cannot be downloaded in either environment available to this project (the
cloud container and the Linux VM are both blocked from `cdn.playwright.dev`
and from Mozilla's servers, confirmed 12 October 2026), and the only
`firefox` apt package on either is a snap stub. Chromium is the only engine
that can be automated here. Firefox and Safari are therefore checked by hand,
and the point of this document is to make that produce evidence rather than
an impression.

Run it against the **live site**, `cw.mikroutik.com`, after a deploy.

## Why these two engines, specifically

Not for completeness. Each is the only place certain things in this
application can actually break:

| Engine | What only it can tell us |
|---|---|
| Firefox | Reduced timer precision can blunt keying measurement; a different WebRTC stack against the live coturn relay; its own print engine for the certificate |
| Safari | `webkitAudioContext` and its stricter gesture rule (`core/audio.ts:151` handles the prefix — untested in the wild); IndexedDB eviction after 7 days of non-use, which the privacy notice's "your progress stays in this browser" depends on; `text-wrap: balance`, which the certificate's centring relies on |

## Before you start

Two accounts, because a contact needs two stations. Register two **training**
accounts with the callsign left blank — they auto-verify, need no
administrator, send no mail, and can be deleted at the end. Use one per
browser.

Have the console open in both (Firefox: Option-Cmd-K. Safari: enable
Develop in Settings → Advanced, then Option-Cmd-C).

## The procedure

Do the whole of part 1 in Firefox, then the whole of part 1 in Safari, then
part 2 across the two of them.

### Part 1 — one browser at a time

1. **Open the site and press Enable sound.** The Audio lamp must read
   `running` in green. *Safari is the one that can fail here* — if it stays
   silent, that is the `webkitAudioContext` path, and it is a real bug.
2. **Receive → Start session.** You should hear K and M at a realistic speed.
   Listen for a click at the start of each element: that would mean the
   envelope is not being applied, which is engine-specific and audible.
3. **Type a drill and press Enter.** The marked copy should appear with hits
   and misses coloured.
4. **Send tab → Arm the key → send a few characters with `[` and `]` →
   Analyse.** Check the Speed figure is in the region you actually sent at.
   *This is the Firefox one*: if its timer precision is blunting the
   measurement, the speed and consistency figures will look wrong in a way
   they do not in Chrome.
5. **Latency check → Measure for real.** Note the number. A wildly different
   figure from Chrome on the same machine is worth reporting.
6. **Settings → Export everything.** A file should download. Then reload the
   page and confirm your course position survived — that is IndexedDB
   working.
7. **Go offline** (turn off wifi) **and reload.** The application should
   still load. Turn wifi back on afterwards.

### Part 2 — the contact, Firefox to Safari

This is the part that has never been run on anything but Chromium.

8. Sign in on the **On air** tab in both browsers, with a different account
   in each.
9. In one: **Find a clear spot → Call CQ here**, and send
   `CQ CQ CQ DE <call> <call> K` on the key.
10. In the other: find that station — the green ring on the scope, or
    **Next ▸** — and press **Answer**.
11. **Watch the Contact badge in both.** It must reach `connected`. If it
    sits on `connecting`, that is the finding, and the console output below
    is what diagnoses it.
12. Send a few characters each way. The other station should hear them, and
    the pad should go amber and read **Their over** while they do.
13. **End contact.** Check the contact appears in **Your log** in both.

### Part 3 — the certificate, both browsers

14. Open **Your account → View and print** on an account that has a
    certificate (the training account from yesterday's testing has one, or
    use any). 
15. Check the text is centred — the title, the name, the statement and the
    seal all on the same axis. Safari is where `text-wrap: balance` could
    differ.
16. **Print → Save as PDF.** It must be **one** A4 sheet, landscape, ink on
    white. Two pages is a finding.

## The console snippet — paste this in both, during the contact

It turns "seemed fine" into something I can read:

```js
copy(JSON.stringify({
  ua: navigator.userAgent,
  version: document.querySelector('.about-version, .panel b')?.textContent ?? '?',
  audio: [...document.querySelectorAll('.badge')].map(b => b.textContent.trim()),
  link: document.querySelector('.link-line')?.textContent ?? 'none',
  sw: !!navigator.serviceWorker?.controller,
  storage: (navigator.storage?.estimate ? 'yes' : 'no'),
}, null, 1))
```

`copy()` puts it on the clipboard in both Firefox and Safari. Paste the
result for each browser.

## What to send back

For each browser: the snippet output, plus the step number of anything that
did not do what this document says it would. **Console errors matter more
than anything else** — for Safari in particular they are the only diagnostic
that reaches Claude at all, since no WebKit build can be run here.

Nothing in part 1 failing in Chrome and failing here is a browser bug;
something failing in all three is ours.

## Afterwards

Delete the two training accounts (Your account → Close my account in each).
