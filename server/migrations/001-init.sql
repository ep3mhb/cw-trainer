-- CW Trainer server schema, first cut (RFP §7, §8).
--
-- Roles are a column from day one, as §8 asks, even though nothing but
-- 'admin' does anything yet: adding the column later means migrating live
-- accounts. Training identifiers are marked, never inferred from the prefix,
-- so a later change of prefix cannot mislabel an old account.

CREATE TABLE members (
  id            BIGSERIAL PRIMARY KEY,
  callsign      TEXT NOT NULL UNIQUE,
  training      BOOLEAN NOT NULL DEFAULT FALSE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'member', 'instructor', 'admin')),
  profile       JSONB NOT NULL DEFAULT '{}'::jsonb,
  muted_until   TIMESTAMPTZ,
  removed       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_member ON sessions(member_id);

CREATE TABLE password_resets (
  token_hash  TEXT PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE
);

-- Both sides get the contact (§7). One row per contact, two member columns;
-- exportable is decided at the time by callsign.ts and stored, so a later
-- change of rule does not rewrite history.
CREATE TABLE contacts (
  id           BIGSERIAL PRIMARY KEY,
  a_id         BIGINT NOT NULL REFERENCES members(id),
  b_id         BIGINT NOT NULL REFERENCES members(id),
  a_callsign   TEXT NOT NULL,
  b_callsign   TEXT NOT NULL,
  frequency_hz INTEGER NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  exportable   BOOLEAN NOT NULL
);
CREATE INDEX contacts_a ON contacts(a_id);
CREATE INDEX contacts_b ON contacts(b_id);

CREATE TABLE reports (
  id          BIGSERIAL PRIMARY KEY,
  by_id       BIGINT NOT NULL REFERENCES members(id),
  about_id    BIGINT NOT NULL REFERENCES members(id),
  reason      TEXT NOT NULL,
  transcript  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE moderation_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    BIGINT NOT NULL REFERENCES members(id),
  member_id   BIGINT NOT NULL REFERENCES members(id),
  action      TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
