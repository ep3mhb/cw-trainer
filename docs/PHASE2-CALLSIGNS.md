# Training callsigns for unlicensed members

RFP open point 14.3. **Settled 20 September 2026: `A0` plus three letters,
with the three rules below.** The reasoning is kept because a later maintainer
will want to know why, and `src/core/callsign.ts` is where it became code.

## What the IARU says: nothing

Checked 20 September 2026. The IARU has no current policy on callsigns at all.
Its only resolution on the subject, 88-5 "Call Signs", is listed as
**suppressed** in the union's own Resolutions and Policies — that is, formally
withdrawn and no longer active guidance. There is no IARU scheme for training
or student identifiers to adopt, and no member society one that applies here.

So there is nothing to copy. The pattern has to be reasoned out, and the
reasoning below is what the maintainer should be asked to approve.

## The regulatory position is narrower than it looks

Two facts, and they point the same way.

**The application never transmits.** The virtual band of §7 is a WebRTC data
channel between two browsers. Nothing reaches a radio, an antenna or a
frequency. No regulator's permission is needed for an unlicensed person to
use it, any more than for them to use a Morse practice oscillator on a
kitchen table.

**On the air, the mechanism already exists and is not a callsign.** Where an
unlicensed person is allowed to operate at all, it is under the direct
supervision of a licensed operator, transmitting under *that operator's*
callsign. There is no such thing as a licence-free training callsign in any
administration, which is precisely why there is no scheme to adopt.

What follows is that the requirement is not "obtain a valid identifier". It is
narrower and entirely within the maintainer's gift:

> An identifier issued by this application must be one that no real station can
> ever hold, and must never be presented as though it were a real callsign.

## The pattern

The ITU divides the callsign space into series allocated to administrations,
series unallocated but available for future allocation, and series that are
**permanently unavailable**. Only the third is safe: an "unallocated" prefix
can be handed to a country next year, and a project decision should outlive that.

The permanently unavailable set is small and well defined:

| Form | Why it can never be issued |
|---|---|
| `Qx` | Confusable with the Q codes |
| `x0`, `x1` | Digits 0 and 1 confusable with the letters O and I |
| `0x`, `1x` | Same reason, leading digit |
| `nn` | Two-digit prefixes are not allocated by the ITU |

`Qx` is unusable here for the obvious reason: a beginner copying `QRS` as a
callsign when it is a request to slow down is exactly the confusion the course
exists to prevent. `nn` produces identifiers that do not look like callsigns
at all, which costs the copying practice its point.

That leaves `x0` and `x1`, which are permanently unavailable for every letter
except B, F, G, I, K, M, N, R and W, whose administrations already use them.

**The recommendation is `A0`**, giving training identifiers of the ordinary
shape: `A0MHB`, `A0RTK`, `A0BQZ`.

Three reasons. It is permanently unallocatable, A not being one of the nine
exceptions. It is callsign-shaped, so copying one is the same exercise as
copying a real one. And `A6` is the UAE, so the shape members practise is the
shape they will meet locally — without ever colliding with it.

The suffix should be the member's own initials where they are free, and
random letters where they are not, so that a member recognises their own
identifier the first time they hear it.

## What the application must do with them

The pattern alone is not the safeguard. Three rules go with it:

1. **Labelled, always.** A training identifier is shown with the word
   *training* beside it everywhere it appears — the band display, the contact
   transcript, the log. It is never rendered to look like a licensed station.
2. **Not exported as a contact.** ADIF export (§7) is read by logging
   programs that upload to LoTW, eQSL and Club Log. A contact with a training
   identifier must be excluded, or exported with a flag that marks it as
   simulated. A member uploading practice contacts to a real award system,
   even by accident, is the one failure here that would embarrass the project.
3. **Replaced, not renamed.** When a member is licensed, their real callsign
   is added and the training identifier retired. Past practice sessions keep
   the identifier they were made under rather than being rewritten, so the log
   stays honest about what was simulated.

## The decision

`A0` plus a three-letter suffix, with the three rules above, approved 20
September 2026. Had `A0` not been wanted, any of `A1`, `C0`,
`C1`, `D0`, `D1`, `E0`, `E1`, `H0`, `H1`, `J0`, `J1`, `L0`, `L1`, `O0`, `O1`,
`P0`, `P1`, `S0`, `S1`, `T0`, `T1`, `U0`, `U1`, `V0`, `V1`, `X0`, `X1`, `Y0`,
`Y1`, `Z0` or `Z1` would have worked on the same reasoning.

## Where it lives

`src/core/callsign.ts`: `issueTrainingIdentifier()` builds one from the
member's initials where free (Mohammad Bahrololoum → `A0MBA`) and random
letters otherwise; `parseCallsign()` refuses an `A0` call offered as a
licensed one; `exportableAsQso()` is rule 2; `describeIdentifier()` hands the
display layer the word for rule 1. Rule 3 is a registry behaviour and waits
for the registry.
