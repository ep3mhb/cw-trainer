# Privacy notice

The notice is **published**, and the published copy is the only one that counts:

> <https://www.mikroutik.com/privacy.html>

Its source is `hosting/www/privacy.html` in this project, served from the
`www.mikroutik.com` document root. It is linked from Help → About and from
"Your account" on the On air tab, by absolute URL and on purpose: the service
worker is cache first and ignores other origins, so a member always reads the
current notice rather than the one that shipped with their build. A statement
about what is held must not be able to go stale in a cache.

This file used to hold a draft written for a project maintainer, before Phase 2
was built. It said the practice history reached the server (it does not), it
left the retention periods as `[30]`, and it is gone: a second, divergent
privacy notice in a repository is worse than none.

## What to check when the code changes

The notice makes claims that the code has to keep true. If you touch any of
these, read the notice before you ship:

| Change | What the notice says |
| --- | --- |
| `ICE_POLICY` moved off `relay` | contacts are relayed, so no member learns another's IP address. `all` makes that false — `SERVER-SETUP.md` §11 says to say so here |
| A new column on `members`, or a new table | "what the server holds, if you create an account" is a list, and it is meant to be complete |
| Anything new written to the journal | the connection-quality lines are described; a new log line about members needs a sentence |
| Retention changed in `journald.conf`, `logrotate`, or a cleanup job | the table gives 14 days for logs, 12 months for reports |
| Backups: the cron in `SERVER-SETUP.md` §10, its 14-day prune, or where the copies go | the notice names the nightly dump, says a copy sits on the shared hosting **encrypted**, and gives 14 days for both. It also says account details and the certificate survive deletion **for up to fourteen days in the backups** — that sentence exists because `deleteMember` cannot reach a dump taken yesterday. Lengthen the prune and you lengthen that promise; add a destination and it joins "the complete list" |
| A third-party service added — analytics, fonts, a CDN, a mail provider | "that is the complete list" is a promise, and today it is netcup, Cloudflare and our own mail server |
| `deleteMember` behaviour | "emptied, sessions ended, callsign released, the other station's log keeps your callsign as text" — and from RFD A37, training records go with it. It is a tombstone, so nothing cascades for you: `deleteTrainingRecords` is called by hand in both stores, and there is a test that fails if it is not |
| `keep_records`, `training_sessions`, `training_characters`, `training_progress` | the notice lists, field by field, what a member who switches this on is agreeing to store, and promises it excludes keystrokes, the Send tab and the band. Add a column and it joins that list. **Off means deleted now, and out of the backups within fourteen days** — the same sentence the account details carry, for the same reason |
| Anything that stores what was keyed | "no audio is recorded and no transcript is kept" — the abuse report is the single exception |
| The final exam, or what `exams` / `certificates` hold | the notice lists the columns of both, says the browser-side lessons reach no one, and says closing the account deletes them — `deleteMember` has to keep doing that, and it is a tombstone, so nothing cascades for you |
| What `GET /api/certificate/:serial` returns | "the callsign, the date, the serial and the score, and nothing else". Adding a field there publishes it |
| Examining a lesson on the server rather than in the browser | "That includes the short exam that stands between one lesson and the next" names the browser as the only party |

Change the notice and move the date at the top of it. Members are told by
email before a change that matters takes effect.

## 14 October 2026 — the table earned its keep

RFD A37 put training records on the server, opt-in. The design document said
plainly that switching it off "deletes everything already uploaded", and so
did the confirmation dialog that had already been written. Both were wrong in
the same way the account-details sentence was wrong on 11 October: the live
rows go at once, and a dump taken yesterday cannot be reached.

Nothing in the code was at fault and no test could have caught it. What
caught it was the backups row in this table, read before the notice was
written rather than after. That is the only reason the row exists, and it is
the first time it has fired.

## 11 October 2026 — what backups did to this notice

There were no backups at all until that afternoon (`SERVER-SETUP.md` §10).
The notice was written when the database existed in exactly one place, and it
said so: "account details — while the account exists". The hour the nightly
dump started, that stopped being true. A member who closes their account is
removed from the live database at once, and then persists in up to fourteen
days of dumps.

Nobody changed a word of the code to break this. A backup is the right thing
to have, and the sentence was right when it was written. It is recorded here
because it is the only entry in this table so far that was broken by an
*operational* change rather than a code one, and the table had no row for
backups to warn anyone. It has one now.

### Later the same evening — the notice nearly shipped ahead of the facts

The backups row above was written while the off-site copy was still a plan
that looked like a formality: the credentials were held, the host was chosen,
only the upload remained. The notice was drafted to match the plan — *"a
second on the shared hosting above, encrypted so that only I can read it"* —
and the bilingual announcement with it.

The upload then failed for three hours and turned out to be two separate
faults. Had the notice gone up when it was written, it would have described a
second copy that did not exist, to members, in the one document that exists to
be relied on.

It was corrected to describe the single on-server copy, and corrected again
once the off-site job was running and had read its own upload back. Both
sentences were true when published.

**The rule this earns**: write the notice from what is *running*, never from
what is about to run. The gap between the two is normally minutes and
occasionally a day, and it is invisible in the finished sentence either way.

One further detail the same evening: the on-server dumps were world-readable
when that first row was written. The notice now says "readable only by the
database account", which became true only after `chmod 700` on the directory
and `600` on the dumps, with `umask 077` in the cron job so the next run
cannot undo it.
