-- RFD A37: a member's training records, kept on the server if they ask.
--
-- Agreed with the project on 14 October 2026. Design: docs/PHASE4-TRAINING-RECORDS.md.
--
-- Everything here is opt-in and off by default. RFP §9 ("no server and no
-- account") and the published privacy notice both remain true for a member
-- who has not switched this on, which is every member until they act. That
-- is the whole shape of the feature and the reason for the column below
-- rather than a flag buried in profile JSONB: a consent is not a preference,
-- and it should be visible in the schema.

ALTER TABLE members
  ADD COLUMN keep_records BOOLEAN NOT NULL DEFAULT FALSE;

-- One row per finished session. The id is the one the browser already
-- generates (`s-<timestamp>`), and (member_id, session_id) is the primary
-- key, so re-posting a session the server already holds is a no-op by
-- schema rather than by client discipline. That is what makes the upload
-- safe to retry on any connection, from any device, for ever.
--
-- There is no UPDATE path to this table. A finished session is an immutable
-- fact; if it ever needs correcting, the correction is a new release and a
-- migration, not a write.
-- NOTE ON THE CASCADES BELOW. Closing an account tombstones the member row
-- rather than deleting it (contacts have to keep pointing somewhere), so
-- ON DELETE CASCADE never fires by itself — which is why deleteMember()
-- already removes exams and certificates by hand. These tables are deleted
-- by hand in the same place. The clauses are kept for the day a row really
-- is deleted, and because a foreign key with no action is worse than one
-- with the right action that rarely runs.
CREATE TABLE training_sessions (
  member_id      BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_id     TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  ended_at       TIMESTAMPTZ NOT NULL,
  lesson_type    TEXT NOT NULL,
  character_wpm  INTEGER NOT NULL,
  effective_wpm  INTEGER NOT NULL,
  attempted      INTEGER NOT NULL,
  correct        INTEGER NOT NULL,
  -- The member's position in the course when this session ended. The report
  -- takes MAX of this rather than the latest, because a session drilled on a
  -- device that was behind would otherwise drag the position backwards.
  unlocked_count INTEGER NOT NULL,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, session_id)
);
CREATE INDEX training_sessions_member_ended ON training_sessions(member_id, ended_at);

-- Per character within one session: enough to rebuild a rollup server-side
-- without storing a single keystroke. response_ms_total is a sum so that a
-- mean survives aggregation.
--
-- The raw per-keystroke attempts are deliberately NOT here. They are bulky,
-- they interest nobody but the local charts, and they are the closest thing
-- this application has to a recording of somebody fumbling. The browser
-- stays their only home.
CREATE TABLE training_characters (
  member_id        BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_id       TEXT NOT NULL,
  character        TEXT NOT NULL,
  attempted        INTEGER NOT NULL,
  correct          INTEGER NOT NULL,
  response_ms_total BIGINT NOT NULL,
  PRIMARY KEY (member_id, session_id, character),
  FOREIGN KEY (member_id, session_id)
    REFERENCES training_sessions(member_id, session_id) ON DELETE CASCADE
);

-- The failed-character weights, which are a property of the member rather
-- than of any one session: a weakness found on the phone should steer the
-- drills on the desktop. Last upload wins, and that is correct here — the
-- weights are a live heuristic, not a record of what happened.
CREATE TABLE training_progress (
  member_id  BIGINT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  weights    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
