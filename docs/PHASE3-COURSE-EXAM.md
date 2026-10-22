# 0.8.0 — the course asks before it promotes, and the course can be finished

Design note, 10 October 2026. Agreed with Mohammad in conversation; nothing
here is built yet. RFD amendment **A25** covers it.

Three pieces ship together: service-worker update detection, the privacy link
in Help → About, and the course change below. The first two are small and
described at the end; the course change is the substance.

---

## 1. Why the course changes

Promotion today needs **≥ 90% accuracy over ≥ 50 attempted characters** in one
session, and a session ends at 10 drills *or* when Stop is pressed. Two
problems follow.

**Stopping early can promote you.** Three drills can easily pass 50
characters. Press Stop while ahead and the next character arrives, silently,
without being asked for.

**And 90% is an average, so averages hide.** At lesson 10 a member has 11
characters. One of them at 40% is about 9% of the stream, so they still score
around 92%, get promoted, and carry that broken character forward for the rest
of the course — where every new lesson dilutes it further and makes it *less*
likely to ever be caught. The rule gets weaker exactly where the course gets
harder.

## 2. The new flow

1. A session ends — 10/10 or stopped early — meeting the existing ≥90% / ≥50
   rule. That rule stays, and its only job now is to decide whether the
   question is worth asking.
2. Instead of promoting, a **calm panel** appears: *"92.4% over 60 characters.
   Take the exam for the next character, or stay with these?"* A panel, not a
   dialog — easy to ignore, never blocking.
3. Decline and it asks again at the end of the next qualifying session.
   Deliberately not a one-time offer, deliberately not a nag.
4. Pass the exam → the new character is added and **mixed in immediately**,
   classic Koch.

Mohammad first asked for a new character to be drilled alone before being
mixed, and changed his mind on the argument that isolated recognition
transfers poorly to picking a character out of a stream, and that it departs
from RFP §4. Recorded because it is the kind of decision that gets revisited.

## 3. The exam

Each unlocked character appears **exactly 4 times**, shuffled into ordinary
mixed groups. It should look and sound like a normal drill: no grouping by
character, no announcement of what is coming.

It passes only if **both** hold:

- every character scores **at least 3 of 4**
- overall accuracy is **at least 90%**

The first rule is the whole point — no character hides behind the others. The
second stops a pass built entirely of 3-of-4s, which satisfies the first rule
without being ready.

**Length is uncapped**, by decision. Lesson 1 is 8 characters, lesson 10 is
44, the final lesson 160 — four or five minutes. The cost should grow with how
much there is to prove, and it is paid once per promotion, not once per
session. A cap would have to spend its budget on some characters and not
others, which reintroduces in miniature the hiding problem the exam exists to
remove.

**Failing** keeps the member where they are, names the characters that let
them down ("D, K and 7"), and imposes no lockout or waiting period. The next
ordinary drills then **over-sample those characters**, so a failed exam steers
the practice instead of merely reporting a result.

## 4. Where the exam runs — the decision that shapes the work

Mohammad's decision: **the certificate is for registered members only, and its
result is stored on the server.** A stored result is only worth as much
as the grading behind it, so the exam moves server-side.

The exam therefore moves server-side. The question is what the server sends.

**Not the characters, and not encrypted characters.** Sending the characters
puts the answers in the response. Encrypting them changes nothing: if the
browser can decrypt, the key is in the browser and the plaintext is in memory
one developer-tools step later. A locked box handed over with its key is not
locked.

**Send the timing.** Morse is key-down and key-up with durations. The server
generates the exam, converts it to a sequence of on/off intervals, and sends
that. The browser plays tones from the intervals and never learns what the
characters are. The member types what they hear; the server grades against
what it sent.

This is better than every alternative considered:

- **No plaintext exists in the client at all** — not in the response, not in a
  variable, not decryptable, because it was never sent.
- **It is small.** A few hundred numbers, against the several hundred
  kilobytes a rendered-audio exam would cost.
- **No audio synthesis on the server** — arithmetic over the timing tables in
  `src/core/timing.ts`, which already exist.
- **The member's own sidetone pitch and volume still apply**, because the
  browser still generates the tone. Only the speed comes from the server,
  which is right: the exam's speed goes on the certificate, so the member
  chooses it when they start and the server records what it sent at.
- `src/core/band-audio.ts` already plays arbitrary key transitions — it is
  what a live contact on the band is made of. The capability is built.

The honest limit: someone could feed the timing array into a Morse decoder,
and the application ships one in `src/core/decoder.ts`. But that is equally
true of rendered audio — it would go to the same decoder — so the timing
stream is about as strong as the expensive option at a fraction of the cost,
and the cheat costs more effort than learning the characters.

### A split worth making

**Promotion exams stay local. Only the final exam is server-graded.**

The reason: to pick an exam's characters the server must know which lesson the
member is on. Course progress is local by RFP §9 and the published privacy
notice, and moving it to the server to support thirty-nine routine promotions
would be a large change for no member-facing benefit.

The final exam needs no such thing. It is always the full 40-character set, so
the server needs to know nothing about the member's history — only that they
can copy the whole alphabet now. The certificate then attests to the exam,
which is the honest claim anyway, rather than to a journey the server never
witnessed.

So:

- lessons 1–39: exam generated and graded in the browser, as everything else
  is, and nothing leaves the device
- the fortieth: `POST /api/exam/start` (with the member's chosen speed) → the
  server generates the sequence, stores the characters against the member, and
  returns **only the timing intervals**; the browser plays them and submits
  what was typed; the server grades against what it stored and, on a pass,
  issues the certificate

## 5. The certificate

Issued on passing the final exam. Registered members only — an unregistered
member can complete the whole course and will be told plainly, before they
start, that a certificate needs an account.

On it, all of it specific and true:

- callsign or training identifier, and name
- the date the final exam was passed
- the speed it was passed at — character WPM and effective WPM, because 40
  characters at 20/10 Farnsworth and 40 at 25/25 are not the same achievement
- the final exam score out of 160
- a serial number

**A4**, with a print stylesheet that inverts to ink on white, because nobody
wants to print a black page.

### Verification, and what it costs

A serial is only worth having if something can be checked against it, which
argues for a public page at `/certificate/<serial>`. But that page would
publish a member's callsign and name to anyone holding the serial.

Proposal: the verification page shows **callsign, date, and speed only** —
never the name, never the email — and issuing the certificate asks the member
whether it may be verifiable at all. Default off. A member who wants to show
the certificate to the project can turn it on; a member who just wants the PDF
need not be listed anywhere.

**This is still open for Mohammad to decide.**

## 6. What this does to the privacy notice

The published notice says, in two places, that drills, settings, session
history and statistics stay in the browser and never reach the server. Storing
exam results makes that **false**, and `app/docs/PRIVACY.md` names this exact
case: a new table means the "what the server holds" list is no longer
complete.

The notice must change **in the same release**:

- a line under "what the server holds": the final exam — when it was sat, what
  was sent, what was typed, the score — and the certificate issued from it
- a retention period for both
- the "stays in your browser" sentence qualified: everything except the final
  exam, which is graded by the server and therefore reaches it
- if verification goes ahead, what a verification page shows and that it is
  off unless asked for

Deleting an account empties the exam and certificate rows with everything
else, and the verification page stops resolving. That should be said rather
than left to be inferred.

## 7. Storage

Local: progress is `{ unlocked: number }` in IndexedDB, carried in the export
envelope at `EXPORT_VERSION = 1`. Exam state and the over-sampling weights for
failed characters change that shape, so the envelope version, the import path
and `parseEnvelope`'s defaults move together.

Server: two tables — exam attempts (member, sequence, answers, score, speed,
timestamps) and certificates (member, serial, exam, issued-at, whether
verifiable). A migration, the first since `003-contact-notes.sql`.

## 8. The other two pieces

**Update detection.** The browser only checks for a new service worker on
navigation, so an installed app left open never checks at all; and when it
does, the page in front of the member was already drawn from the old cache, so
they need a *second* ordinary reload that nothing asks them for. Members sit
on stale builds indefinitely — hit twice during testing on 10 October. Fix:
`registration.update()` on `visibilitychange` and on a timer; drop
`skipWaiting()` from `gen-sw.mjs` so the new worker waits rather than serving
new assets to old code; a dismissible banner with a Reload button that
releases the waiting worker. Never an automatic reload — it would throw away a
drill, or drop a member off the band mid-contact.

**Privacy link in Help → About.** It currently sits nine sections down under
"Working other members on the air". About is first in the contents list and
already discusses what the application does with data.

## 9. Tests this needs

- the exam's per-character rule: a set where one character is 2 of 4 and
  everything else is perfect must fail, and the message must name it
- the overall rule: every character exactly 3 of 4 must fail on the 90% bar
- exam length is 4 × set size at several lesson numbers
- declining the offer leaves progress untouched and the offer returns next
  qualifying session
- failed characters are over-sampled in the next drills, and the weighting
  clears once they pass
- server: the response to `exam/start` contains **no characters** — asserted
  directly, because this is the one property the whole design rests on
- server: the timing stream decodes back to the stored characters (round-trip
  through `src/core/decoder.ts`, so a timing bug cannot silently fail everyone)
- server: an exam cannot be graded twice, a submission for someone else's exam
  is refused, an expired exam is refused, a certificate is issued only on a
  pass, and a deleted account takes its certificate's verification with it
- the export envelope round-trips the new progress shape, and an old export
  still imports

---

## 10. Beyond 0.8.0 — keeping a registered member's records on the server

Raised by Mohammad on 10 October, after the timing-stream decision: if someone
registers at the start, why not hold all their records on the server and give
them a full report whenever they want?

**It is worth doing, and it should not be part of 0.8.0.** 0.8.0 is already a
course change, a server-graded exam, a certificate, a notice revision and a
migration. This is its own release.

Mohammad's own framing, 10 October: if the member chose this at registration,
a summary of each session is saved and they can **retrieve it from any PC or
phone and carry on training there**. So this is not only a report — it is
portable progress. That is the part that decides the design.

### What it would fix

Real problems, not hypothetical ones. Practice history lives in one browser:
a member who drills on their phone and their desktop has two unrelated
histories and neither is their progress. Clearing browsing data destroys
everything, and the help page already has to warn about it. An instructor —
a role that exists in the schema and does nothing — could actually see how a
student is getting on. And a certificate would rest on a journey the server
witnessed rather than on one exam.

It also removes the awkwardness in §4: if the server knows a member's lesson,
promotion exams could be server-graded too, and the local/server split above
stops being necessary.

### How, and how not

**Not a full two-way sync.** Offline-first synchronisation is genuinely hard:
two devices, both offline, both editing, and last-write-wins quietly eats
somebody's evening of practice. The attempts store uses auto-increment keys,
so there are not even stable identifiers to merge on.

**Append-only session upload instead.** A finished session is an immutable
fact with an id the browser already generates (`s-<timestamp>`). Post it when
it ends, or on the next connection; the server ignores one it already has.
Carry the per-character counts for that session with it so rollups can be
rebuilt server-side. The browser stays the source of truth for raw per-keystroke
attempts, which are bulky and interesting to nobody but the local charts.

That is conflict-free by construction, cheap, works offline, and is enough for
a full report and for a member's position to follow them between devices.

**Carrying on elsewhere** needs one more rule, and only one. On signing in,
the application takes the **higher** of the local and server `unlocked`
counts. Progress only ever moves forward — a character is unlocked by passing
an exam and is never taken back — so the maximum is always the true position,
whichever device earned it. No merge, no conflict, no clock to trust. A member
who drilled offline on a train keeps that work when they next sign in on the
desktop; a member on a fresh browser inherits where they got to.

The same upload carries the failed-character weights, so a weakness found on
the phone still steers the drills on the desktop.

### What it would cost

The notice changes much more than 0.8.0 asks of it — practice history on the
server is the opposite of what members have been told since Phase 1, and RFP
§9 says plainly "no server and no account". That is an amendment and a
conversation with the project, not a footnote.

It should also be a **choice at registration**, not a consequence of having an
account. Some members will like a report; some would rather their fumbling
stayed on their own machine. Asking costs one checkbox and makes the answer
honest either way.
