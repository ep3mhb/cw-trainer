# 0.9.0 — a member's training records, on the server, if they ask for it

Raised by Mohammad on 10 October and held out of 0.8.0 deliberately; the
design is `PHASE3-COURSE-EXAM.md` §10. Put to the project and **agreed on 14
October 2026**: if a member is interested in keeping their training records
on the server, so that they can retrieve a progress report or carry a session
on to another machine, that is acceptable and worth offering.

This document is what the code and the privacy notice are both written from.
Where they disagree with it, one of them is wrong.

## 1. What a member is actually being offered

Two things, and they come from the same upload:

- **A progress report.** Their own history, readable from anywhere, instead of
  whatever happens to be in the browser in front of them.
- **Carrying on elsewhere.** Drill on the phone on a train, sit down at the
  desktop, and be in the same place in the course.

The second is the one that shapes the design. A report could be a nightly
export; portable progress cannot.

## 2. What is stored, and what is not

**Stored, per finished session:** the session id the browser already
generates (`s-<timestamp>`), when it started and ended, the lesson type, the
two speeds, how many characters were attempted and how many were right, and
the unlocked count at the time. Per character within that session: attempted,
correct, and the summed response time so a mean survives.

**Also stored, per member:** the failed-character weights, so a weakness found
on the phone steers the drills on the desktop.

**Not stored, and this matters:** the raw per-keystroke attempts. They are
bulky, they are interesting to nobody but the local charts, and they are the
closest thing this application has to a recording of somebody fumbling. The
browser remains their only home.

**Not stored either:** anything from the Send tab, the band, or contacts.
This is the Koch course and nothing else.

## 3. Append-only, never a sync

**Not a two-way sync.** Two devices, both offline, both edited, and
last-write-wins quietly eats somebody's evening of practice. The attempts
store uses auto-increment keys, so there are not even stable identifiers to
merge on.

**A finished session is an immutable fact.** It is posted when it ends, or on
the next connection; the server ignores one it already holds. The primary key
is `(member_id, session_id)`, so idempotency is the schema's job rather than
the client's. Conflict-free by construction, works offline, and cheap.

## 4. Carrying on elsewhere needs exactly one rule

On signing in, the application takes the **higher** of the local and server
`unlocked` counts.

Progress only ever moves forward — a character is unlocked by passing an exam
and is never taken back — so the maximum is always the true position,
whichever device earned it. No merge, no conflict, no clock to trust. A member
who drilled offline on a train keeps that work; a member on a fresh browser
inherits where they got to.

The server derives its side as `MAX(unlocked_count)` over the sessions it
holds, so there is no second place for it to drift.

## 5. Consent — three decisions, settled 14 October

**It is off until a member turns it on.** A checkbox at registration, and a
setting in "Your account" for everyone who already has one. Having an account
does not imply this. Some members will like a report; some would rather their
fumbling stayed on their own machine, and asking costs one checkbox.

**Off means deleted.** Turning it off removes everything already uploaded, not
just future uploads. It is the only reading of "off" that needs no explaining,
and it matches what closing an account already does.

**With one caveat that must be said out loud: the nightly backups.** The live
rows go at once; a dump taken yesterday cannot be reached, and both copies are
pruned after fourteen days (`SERVER-SETUP.md` §10). So the true sentence is
"deleted now, and out of the backups within fourteen days" — which is exactly
what the notice already says about account details and about the final exam,
for the same reason. Anything that tells a member plainly that switching off
deletes everything is wrong, including a confirmation dialog.

**Instructors cannot see it.** The role exists in the schema and still does
nothing here. Agreeing to keep your own records is not agreeing that a project
officer may read them; that is a second consent and deserves its own
conversation. Deliberately out of scope.

## 6. What this does to the privacy notice

More than 0.8.0 asked of it. The notice has said since Phase 1 that practice
never reaches the server, and RFP §9 says "no server and no account". Both
remain true **for a member who has not opted in**, which is every member until
they act — and that is how the notice must put it: the default is unchanged,
and the exception is something you switch on.

`PRIVACY.md` lists which claims break. The notice is written from what is
running, not from what is about to run, so it is revised and uploaded in the
same sitting as the server, not before.

## 7. Deletion, in all three ways it can happen

- **Switch the setting off** — sessions, characters and weights deleted; the
  consent flag goes false. The account itself is untouched. Out of the nightly
  backups within fourteen days, as above.
- **Close the account** — and here the obvious assumption is wrong. Closing
  an account **tombstones** the member row rather than deleting it, because
  contacts have to keep pointing somewhere. `ON DELETE CASCADE` therefore
  never fires, which is why `deleteMember` already deletes exams and
  certificates by hand. The new tables must be deleted by hand in the same
  place, in **both** store implementations. The cascade clauses stay in the
  migration for the day a row really is deleted, but nothing routine relies
  on them.

  Caught while reading `deleteMember`, after this document had already
  claimed the cascade would do it. Had it gone unnoticed, the notice would
  have promised that closing an account removes a member's practice history
  while the rows sat there.
- **Ask the operator** — unchanged, the same route as any other data question.

A member who switches off and later switches on again starts empty. That is
the honest consequence of "off means deleted" and the notice says so.

**Caught by reading `PRIVACY.md` rather than by thinking harder.** That file
keeps a table of "if you touch this, read the notice", and the backups row
exists because the same thing happened on 11 October: a true sentence about
account details stopped being true the hour the nightly dump started, with
nobody changing a line of code. The row did its job this time, before the
notice was written rather than after.

## 8. What this release is not

- Not instructor visibility (§5).
- Not server-graded promotion exams. §10 observes they become possible once
  the server knows a member's lesson; possible is not the same as wanted, and
  the local/server split in `PHASE3-COURSE-EXAM.md` §4 is working.
- Not a leaderboard, and not any view of one member's records by another.
- Not a replacement for the local store. The browser stays the source of
  truth for everything it already holds; the server is a copy of a summary.

## 9. Tests this needs

Against real PostgreSQL, not a mock — the 0.8.5 lesson was five store
functions that had never touched a live database until they were exercised in
production.

- The same session uploaded twice leaves one row.
- An upload from a member who has not opted in is refused.
- Switching off deletes every row, and the member can still sign in.
- Closing the account cascades sessions, characters and weights.
- `MAX(unlocked_count)` is what the report returns as position, including when
  a later session has a *lower* count because it was drilled on a stale device.
- A member with no uploaded sessions gets an empty report, not an error.

**Done, 14 October 2026.** Fifteen cases through the API against the in-memory
store (92 server tests in all), plus the SQL exercised against a real
PostgreSQL 16 in the cloud container: all five migrations applied in order,
the upload INSERT run twice leaving one row, the report's SUM and MAX
queries, the foreign key refusing an orphan character row, and
`deleteTrainingRecords` emptying all three tables.

**What that run proved, and it is the reason for doing it:** after
tombstoning the member exactly as `deleteMember` does, **two training rows
were still there**. The cascade is decoration; the hand-written deletes are
what keep the promise. Reasoned out first, then demonstrated — the right way
round for once.

**`PgStore` has now run against PostgreSQL too, 14 October 2026.** The
earlier caveat here — that the queries had been checked through `psql` but the
class holding them had never executed — is closed. The release build of the
server was run against PostgreSQL 16 in the cloud container and driven
through its own HTTP API: registration with `keepRecords: true` came back
`true` rather than the stale `false` the fix was written for; an upload, a
repeat of the same session returning `added: 0`, and a later session with a
*lower* `unlockedCount` leaving the reported position at 12; both validation
refusals; switching off emptying the report and then refusing uploads;
switching back on starting empty. Closing the account was then checked
against the tables directly: 2 sessions, 2 characters and 1 progress row
before, **0/0/0 after**. Every path a member can take to delete their records
has been seen to work on a real database, through the real class.

**And the built client was driven against that stack in a real browser**,
which is what found the one fault reasoning had missed: only the tab in view
is built, so `ctx.member` was null until the On air tab had been opened in
that page load, and neither the report nor the pulled course position could
appear for a member who had not been there. Nothing was lost — unsent
sessions queue — but the feature looked broken. `main.ts` now asks once at
load when a session token is present. Verified in the browser afterwards:
Progress shows the report and 12 of 40 on a cold load, and the network is
silent for a browser with no account.

## 10. The cost nobody asks about

A registration checkbox, an account setting and a report view are all things
the manuals document, and the manuals are kept in step. That is three
editions, 147 pages, with every figure retaken against a running stack. The
code is the smaller half of this release.
