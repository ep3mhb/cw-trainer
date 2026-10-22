## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- What was wrong, or what the application could not do before. -->

## How it was verified

<!-- Not "it works" — say what you actually did. -->

- [ ] `npm run lint && npm test && npm run build` pass locally
- [ ] Added or updated a test that fails without this change
- [ ] Tried it in a browser, and said which one below

Browsers tried:

## Timing and audio

Tick whichever apply, or say not applicable:

- [ ] No element length or gap is decided by `setTimeout` / `setInterval`
- [ ] Tones are still scheduled against `AudioContext.currentTime`
- [ ] Checked against PARIS timing, or the existing timing tests cover it
- [ ] Not applicable — this change does not touch audio or timing

## Data

- [ ] No new stored field, or the new field is in `src/storage/schema.ts` and in
      the export envelope
- [ ] An export from the previous version still imports

## Sign-off

- [ ] Commits are signed off (`git commit -s`) per `CONTRIBUTING.md`
