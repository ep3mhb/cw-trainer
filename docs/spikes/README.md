# Spikes

One-off harnesses that answered a question once. They are kept because
re-deriving the method costs more than the file does, and they live here
rather than under `tests/` so the suite never collects them: they are not
regression tests and they will drift with the code.

Expect to fix imports before one runs again.

## transport-sweep.test.ts

The Phase 2 transport spike, September 2026. Plays a full CQ exchange through
synthetic network traces — wired, home wifi, across Europe, mobile while
moving, hotel wifi in the evening — against buffer sizes, over a reliable and
an unreliable channel.

Its findings are recorded permanently in **RFD A9** and are the reason the
play-out buffer is 200 ms and the data channel is reliable and ordered:
jitter does not damage timing when every transition carries the sender's
clock; an unreliable channel destroys characters on a home-wifi trace while
the same trace is perfect on a reliable one, because a retransmission arrives
about one round trip later and the buffer absorbs it; and 250 ms is
indistinguishable from 200 ms on a good link and on a bad one alike.

Re-run it only if those numbers are ever questioned.
