-- 007: a series of drills that is still in progress (RFD A42)
--
-- Reported by Mohammad on 16 October 2026, hours after A41 was proved: two
-- drills of ten done on a laptop, then the telephone offered a fresh series
-- starting at the first drill. A40 made the course POSITION travel. This
-- makes the work a member is part of the way through travel too.
--
-- Three faults lay behind the report, and only the server's part is here.
-- The count of drills completed existed solely as a value held in the page;
-- a part-finished series was written out only when the member moved to
-- another tab within the application; and a series written out after two
-- drills was recorded as a finished session of two drills, which can never
-- earn a promotion because the rule wants fifty characters in one session.
--
-- THIS IS THE FIRST TRAINING ROW THE SERVER HOLDS THAT IS NOT FINAL, and
-- the clauses below are what contain that. Everything in 005 is written once
-- and never altered, which is a considerable part of why the design is easy
-- to trust; a row here is deliberately a different kind of thing, and it is
-- kept in a table of its own rather than by adding a nullable ended_at to
-- training_sessions, so that "a row in training_sessions is a finished
-- session" stays true without qualification.
CREATE TABLE training_open_sessions (
  member_id      BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The same id the browser already generates, `s-<timestamp>`, and the same
  -- shape of key as a finished session. Adopting a series is therefore not a
  -- new mechanism but the existing one applied to a row that is not yet
  -- closed, and the same series uploaded from two devices collides on this
  -- key rather than arriving twice.
  session_id     TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  lesson_type    TEXT NOT NULL,
  character_wpm  INTEGER NOT NULL,
  effective_wpm  INTEGER NOT NULL,
  -- How far through the ten the member has reached. This is the field the
  -- report exists to carry, and the field that decides a disagreement.
  drills_done    INTEGER NOT NULL,
  attempted      INTEGER NOT NULL,
  correct        INTEGER NOT NULL,
  unlocked_count INTEGER NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, session_id)
);
CREATE INDEX training_open_sessions_member_updated
  ON training_open_sessions(member_id, updated_at DESC);

-- Frozen the moment it is finished. A series that has been uploaded as a
-- finished session must never reappear as an open one: without this, a
-- device that was offline when the series ended could post a stale open copy
-- afterwards and reopen a closed record. The server deletes the open row
-- when the finished session arrives, and refuses an open row whose key is
-- already present in training_sessions; the constraint cannot be expressed
-- in the schema across two tables without a trigger, so it is enforced in
-- uploadTraining and stated here so the next reader knows it is intended.
