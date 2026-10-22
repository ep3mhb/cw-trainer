# CW Trainer — signalling server

The server half of RFP §7 and §8: introduces two browsers so they can key
each other over a WebRTC data channel, keeps the virtual band, mints TURN
credentials, holds accounts, and logs contacts. It is small — one process,
one PostgreSQL database, three dependencies — and it is meant to stay that
way.

    server/
      src/server.ts   process: HTTP + WebSocket wiring, flags, shutdown
      src/hub.ts      the band: admission, key fan-out, signal relay, moderation
      src/api.ts      accounts over JSON: register, login, reset, profile, log
      src/store.ts    everything kept, behind one interface (memory + PostgreSQL)
      src/auth.ts     scrypt passwords, session tokens
      src/turn.ts     coturn credentials
      src/mail.ts     password-reset mail, or a log line when SMTP is not set
      migrations/     numbered SQL, applied with --migrate
      tests/          run from the repository root with `npx vitest run server/tests`
      deploy.sh       push the source to the box, build, install, restart, verify

The protocol is **not** defined here. It is `src/core/signalling.ts`, the
same file the browser imports, bundled in at build time. A message shape has
one definition and both ends of the wire use it.

## Run locally

    export DATABASE_URL=postgres://cw:pw@localhost/cw TURN_SECRET=x TURN_URI=turn:localhost:3478
    npm ci && npm run build
    node dist/server.js --migrate
    node dist/server.js

`GET /health` answers `{"ok":true,...}`. The band is `ws://localhost:8080/ws`.

## Configuration

All from the environment (`/etc/cw-signalling.env` in production):

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `TURN_SECRET` | yes | coturn's `static-auth-secret` |
| `TURN_URI` | yes | e.g. `turn:sig.mikroutik.com:3478` |
| `ICE_POLICY` | | `relay` (default) or `all` — see docs/PHASE2-SERVER.md |
| `ADMIN_CALLSIGN` | | the callsign that registers as administrator (default `EP2MHB`) |
| `APP_ORIGIN` | | the application's origin, the only one allowed to call the API (default `https://cw.mikroutik.com`) |
| `PORT`, `HOST` | | default `8080`, `127.0.0.1` — never bind publicly; Caddy fronts it |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | | reset mail; without `SMTP_HOST` the mail is logged, not sent |
| `TURN_TTL_S`, `SESSION_TTL_S` | | credential and session lifetimes (6 h, 30 days) |

## Deploy

    ./deploy.sh <you>@sig.mikroutik.com

One command: builds on the box, installs, migrates, restarts, and checks `/health`
reports the version it built. Full runbook: `docs/SERVER-SETUP.md`.
