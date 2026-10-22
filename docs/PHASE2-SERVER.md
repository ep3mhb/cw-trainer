# The Phase 2 server

One small VPS carries all of Phase 2: signalling, TURN, the database, and the
static application itself. This is what to buy and what has to be true of it.

## What to buy

| | |
| --- | --- |
| **Size** | 2 vCPU, 4 GB RAM, 40 GB disk |
| **Cost** | around EUR 4–6 / USD 5–7 a month |
| **OS** | Debian stable or Ubuntu LTS |
| **Needs** | a public IPv4 address of its own, and root |

That size is generous rather than tight. A project of this size will not trouble
it: keying is a few bytes a second, and the database holds practice records,
not media. Take the smaller tier if the provider offers one; you can resize
later and you cannot easily change provider.

The RFD budgeted **USD 500–1,200 a year** for hosting. The real figure is
**USD 60–90**, because TURN bandwidth for Morse is negligible — a contact
relays less traffic than loading one photograph. Worth telling the maintainer,
since it changes what the Phase 2 decision is actually weighing.

## The box chosen (20 September 2026)

**Hetzner CX23** — 2 vCPU, 4 GB RAM, 40 GB SSD, 20 TB traffic, EUR 5.49 a
month. It matches the specification above exactly, and the traffic allowance
is twenty thousand times what the arithmetic below says this will use.

Check before ordering: whether a primary IPv4 address is included in that
price or billed separately, since the specification requires one.

**Take Falkenstein, not Helsinki.** The CX line is only offered in Hetzner's
European locations — Falkenstein, Nuremberg and Helsinki — and Falkenstein is
the closest of the three to the Gulf.

### The one thing to measure before switching relay-only on

Europe is not next door, and the relay decision below interacts with that.
Two members in Dubai connecting directly are a few milliseconds apart. The
same two relayed through Falkenstein take the path Dubai → Germany → Dubai,
which on the usual figures is something like 110 ms one way.

That fits inside the 200 ms play-out buffer with room to spare, but the room
is no longer generous, and the transport spike was emphatic that a link with
no headroom fails in exactly the way members misread as bad sending.

**Measured 20 September 2026**, from a home connection in Dubai to the box in
Falkenstein: round trip **115.6 ms average, 5 ms standard deviation** over the
sample. A relayed contact between two Dubai members is one full round trip
one-way, so ~116 ms against a 200 ms buffer leaves 84 ms of headroom, and the
small deviation says the path is steady. Repeated the same evening after
20:00 local, when residential links are busiest: **115.0 ms, 3.9 ms
deviation** — the same path. **Relay-only stands**, measured twice.

**And then a phone, 21 September 2026.** The ping was from a Mac on a wired
connection; the first member on an iPhone over home wifi through the same
relay had a third of its key transitions arrive too late for the 200 ms
buffer. The path was steady; the phone's wifi was not. The answer was not a
larger fixed buffer — the same evening's Mac needed none of it — but a
buffer that adapts to the receiver it is on (`src/core/link.ts`, 0.4.5).
The 200 ms figure above is now the floor a good connection sits at, not a
budget every connection has to fit.

The reasoning that produced the thresholds, kept for the next time the server
moves: measure the real one-way delay from a member's connection through it
before committing to relay-only. If the margin is
comfortable, relay everything and members never see each other's addresses.
If it is thin, use TURN as a fallback only — and say so in the privacy notice,
because then members working each other directly can see each other's IP
addresses.

## Names (settled 20 September 2026)

| Name | Points at | For |
| --- | --- | --- |
| `cw.mikroutik.com` | existing host | the application itself |
| `sig.mikroutik.com` | this VPS | signalling WebSocket and TURN |
| `mail.mikroutik.com` | mail provider | outbound only, for password resets |

The mail name sends and does not receive. It needs an SPF record, a DKIM key
and a DMARC record on day one, or password-reset mail lands in spam and every
member concludes the account system is broken.

## What TURN actually costs

§7 requires a figure for this, on the assumption that TURN "relays media and
carries a real hosting cost". For this application it does not, and the
arithmetic is worth putting in front of the maintainer.

TURN relays whatever the data channel carries, and what it carries is key
transitions — not audio. At 20 WPM a member produces roughly ten transitions
a second; with SCTP, DTLS and UDP headers that is about 1 kB/s in each
direction, so a relayed contact costs around **7 MB an hour, both ends
together**.

Forty members at a hundred contact-hours a month, with *every* contact
relayed, is **under 1 GB a month**. VPS plans at this price include one to
twenty terabytes. The honest figure for TURN bandwidth is therefore **zero
above the cost of the box** — it is a rounding error against a single member
loading the application once.

This is the whole dividend of §7's "send keying events, not audio". A video
call between the same two members would relay about a thousand times more.

## Where to put it

Close to the members, which means the Gulf, or failing that India or Europe.
Not for the reason people assume: signalling latency is irrelevant, because
signalling only runs while two browsers are introducing themselves.

It matters for **TURN**. When a member's network blocks a direct connection,
their keying is relayed through this box, so the path becomes member → server
→ member instead of member → member. A server in the wrong hemisphere can add
150 ms to that, and the transport spike found the play-out buffer has no room
to spare on a poor link.

Most contacts will connect peer-to-peer and never touch TURN at all. So
prefer a nearby region, but do not pay a large premium for one.

## What runs on it

| Service | Port | Purpose |
| --- | --- | --- |
| Caddy or nginx | 80, 443 | TLS, serves the application, proxies signalling |
| Signalling | internal | WebSocket; introduces two browsers, then gets out of the way |
| coturn | 3478, 5349, 49160–49200 UDP | relay for members whose network blocks direct connections |
| PostgreSQL | local only | accounts, profiles, practice history, logs |

Nothing but 80, 443 and the TURN ports should be reachable from outside. The
database listens on localhost and nowhere else.

## Before it holds a single member account

- **TLS, automatically renewed.** Caddy does this unprompted; with nginx use
  certbot. Web Audio, WebRTC and installing the app all require a secure
  origin, so this is not optional even for the static files.
- **Backups off the machine.** A nightly database dump to somewhere that is
  not this VPS. A backup on the same disk is not a backup.
- **Unattended security upgrades**, and a named human who reads the mail the
  machine sends.
- **The privacy notice published**, and someone answering the address in it.
  A draft is in `docs/PRIVACY.md`; it needs the project's own contact address and
  the maintainer's approval before it goes up.
- **TURN forced on, or the decision to leave it optional taken deliberately.**
  See the note below: it is a privacy choice, not a performance one.

## The one thing about WebRTC nobody expects

When two browsers connect directly, they learn each other's IP address. That
is not a leak or a bug, it is how a direct connection is established at all —
and it means that by default, two members who work each other on the virtual
band can each see roughly where the other lives and who their provider is.

Setting the connection policy to relay-only sends every contact through
coturn on this box, so members see the server's address and never each
other's. The cost is one extra hop, which the measurements say the play-out
buffer absorbs, and the bandwidth computed above, which is nothing.

**Relay-only it is** (measured, above), and the privacy notice says so.

## What it costs to neglect

Phase 1 has no server and therefore no attack surface, no patching and no
data to lose. This box has all three, permanently. That is not a reason to
avoid it — it is the price of live contacts, and the project decided the price
was worth paying — but it should be budgeted as attention, not only money.
