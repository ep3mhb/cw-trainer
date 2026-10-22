-- RFD A25: the final exam and the certificate it earns.
--
-- The exam is graded by the server, so the server has to hold what it sent.
-- `characters` is exactly that, and it is the one column in this schema that
-- must never leave the machine: the browser is sent the TIMING of the Morse
-- and nothing else, so that the answers are not in the response it is being
-- asked to answer. See docs/PHASE3-COURSE-EXAM.md §4.
--
-- Only the fortieth character's exam comes here. Lessons 1 to 39 are examined
-- in the browser, as all practice is, and nothing about them reaches the
-- server (RFP §9).

CREATE TABLE exams (
  id             BIGSERIAL PRIMARY KEY,
  member_id      BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- What was sent. Never returned to a browser, by any route.
  characters     TEXT NOT NULL,
  character_wpm  INTEGER NOT NULL,
  effective_wpm  INTEGER NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- An exam left open forever is an invitation to sit it with help, so it
  -- expires. Generous: the exam itself takes a few minutes.
  expires_at     TIMESTAMPTZ NOT NULL,
  -- Null until it is submitted; set exactly once, which is what stops an
  -- exam being graded twice until something passes.
  submitted_at   TIMESTAMPTZ,
  typed          TEXT,
  correct        INTEGER,
  passed         BOOLEAN
);
CREATE INDEX exams_member ON exams(member_id);

CREATE TABLE certificates (
  serial     TEXT PRIMARY KEY,
  member_id  BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  exam_id    BIGINT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Whether the public lookup answers for this serial. Set TRUE when the
  -- certificate is issued, because the sheet carries a QR square that has to
  -- resolve; the holder can switch it off again from "Your account", and
  -- closing the account deletes the row outright.
  verifiable BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX certificates_member ON certificates(member_id);
