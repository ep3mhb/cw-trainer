# Seams left for Phase 2

RFP §2: *"Phase 2 must not require rewriting Phase 1. Proposals should state how
Phase 1 will be structured so that progress data, settings and the training
engine move to a server-backed model without redesign."*

This is how it was structured, and where the joins are.

## The export envelope is the migration format

`src/storage/schema.ts` defines `ExportEnvelope` with an explicit
`EXPORT_VERSION`. It already carries everything a member accumulates: settings,
course progress, session records, raw attempts, per-character rollups and
sending runs.

Phase 2's account signup reads this file directly — acceptance criterion 9 ("A
Phase 1 export loaded into a new account, statistics preserved") is a matter of
posting the envelope, not of writing a converter. `parseEnvelope()` is the
validator and already rejects unknown versions by name rather than failing
obscurely.

Keep the rule from `CONTRIBUTING.md`: anything worth storing goes in the
envelope. Data outside it cannot migrate.

## Storage is behind one class

Every read and write goes through `Store` in `src/storage/db.ts`. Nothing else
in the application touches IndexedDB. Phase 2 replaces or wraps that one class —
most usefully by keeping it as the offline cache and adding a sync layer above
it, which is the "queue and reconcile" option the RFP asks to be priced
separately (§9).

The method surface Phase 2 has to satisfy is small: settings, progress,
sessions, attempts, sending, rollups, export, import, clear.

## The training engine has no knowledge of storage or the DOM

`src/core/` is pure: timing, audio, keyer, decoder, generators, Koch rule,
statistics. It takes settings in and returns schedules, decodes and numbers. It
can run in a Node process, in a Web Worker, or on a server, unchanged.

This matters for two Phase 2 items:

- **Live QSO (§7)** transmits keying events, not audio, and each receiving
  browser generates the tone locally. That local generation is
  `CwAudioEngine.toneAt(atS, durationS)` — already the method the iambic keyer
  uses, already taking an absolute audio-clock time, which is exactly what a
  jitter-buffered stream of remote key transitions needs. A 150–250 ms buffer
  offset applied to `atS` is the whole client side of it.
- **Band conditions** (§6, reused by §7 as a toggle) should be built as their
  own node graph inside the audio engine rather than as sidetone options, so the
  live path can switch them on per contact.

## Profile fields the robot and live QSO both need

RFP §8 lists name, callsign, QTH, grid, rig, antenna, licence status, preferred
sidetone and target WPM as one source of truth feeding the robot and live
contacts. Phase 1 stores only the sidetone frequency and speeds, in `Settings`.

When Phase 2 adds a profile, the robot QSO work (see `ROADMAP.md`) should read
the student's side of the exchange from that profile rather than from its own
copy — worth building the robot with the profile shape in mind even before
accounts exist, so there is no duplicate entry to unpick later.

## Roles and the callsign registry

Nothing in Phase 1 needs authentication, so none is stubbed — a fake auth layer
would be worse than none. Two notes for whoever builds §8:

- The roles column (student, member, instructor, admin) belongs in the schema
  from day one even with no instructor UI, as the RFP says. Adding it later
  means migrating live accounts.
- The administrator account is Mohammad's own callsign, **EP2MHB** (settled 20
  September 2026). It is a real licensed callsign and belongs in the registry as
  one, not as a generated training identity.
- The training-callsign pattern for unlicensed students is still an open point
  (§14). Phase 1 generates random plausible callsigns for *drills* only, from
  `CALL_PREFIXES` in `src/data/wordlists.ts`; these are practice content, not
  identities, and must not be confused with the registry.

## What deliberately does not exist yet

No signalling, no TURN, no accounts, no server, no Docker Compose. Phase 1's
running cost is a domain name, which is the point of the phase split. The
CODEOWNERS entries for `/src/auth/`, `/src/signalling/` and `/server/` are in
place so that maintainer review is enforced from the first commit that creates
them.
