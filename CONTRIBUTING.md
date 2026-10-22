# Contributing

Thanks for looking at this. The application trains members in CW, so a
regression in the timing engine or the decoder degrades people's practice in
ways that are hard to notice — most of what follows is about that.

## Getting set up

```
npm install && npm run dev
```

Before opening a pull request:

```
npm run lint && npm test && npm run build
```

CI runs exactly those, plus coverage.

## Sign your commits (DCO)

Every commit needs a `Signed-off-by` line certifying you wrote the change and
can contribute it under the Apache License 2.0:

```
git commit -s -m "Fix dah length at high weighting"
```

We use the Developer Certificate of Origin rather than a contributor licence
agreement. There is nothing to sign and no account to create; `-s` is all of it.

## Things that will get a pull request sent back

**Timing driven by a timer.** Tone scheduling goes through
`AudioContext.currentTime`. `setTimeout` and `setInterval` are wake-ups only:
they may ask the keyer to look at the clock, they may never determine how long
an element is. This is an acceptance criterion for the project, verified by code
review, not just a style preference.

**Untested changes to the timing engine or the decoder.** `src/core/timing.ts`
and `src/core/decoder.ts` carry coverage thresholds for a reason: a subtly wrong
dit length or gap boundary produces an application that still looks like it
works while quietly teaching bad habits. Add the test that would have caught
your bug.

**Character-by-character comparison of a student's answer.** Use
`alignAnswer`. Index-by-index comparison marks every character after a dropped
one as wrong, which corrupts accuracy, the confusion matrix and the promotion
rule together.

**State carried by colour alone.** This is an audio application used by people
who may not distinguish the colours; every coloured badge also carries a word or
a number. See `src/style.css`.

**A new runtime dependency.** Phase 1 ships with none, and that is a feature.
Dev dependencies are fine. If you think a runtime dependency is genuinely
warranted, open an issue first and make the case.

**Storing anything outside the export format.** If a change adds data worth
keeping, add it to `src/storage/schema.ts` and to the export envelope. Anything
not in the envelope cannot follow a member to a new device or into a Phase 2
account, and will be lost silently.

## Areas needing a maintainer review

Changes touching authentication or signalling need a maintainer's review before
merge (RFP §11). Neither exists in Phase 1; the rule is written down now so it
is already in force when Phase 2 adds them. See `.github/CODEOWNERS`.

## Deployment configuration

Never commit deployment configuration, secrets or keys. The
production deployment lives in a separate private repository. `.env.example`
documents the variable names and nothing else.

## Layout

```
src/core/      timing, audio, keyer, decoder, morse tables, stats — pure where possible
src/data/      operator-editable content: word lists, robot QSO slot values
src/storage/   IndexedDB store and the versioned export format
src/ui/        views; the only place that touches the DOM
tests/         unit tests for src/core and src/storage
scripts/       build-time helpers (service worker generation)
```

The rule of thumb: logic goes in `src/core` where it can be tested without a
browser, and `src/ui` stays thin enough to be checked by using it.
