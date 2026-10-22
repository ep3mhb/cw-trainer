-- RFP §7: the log is meant to be exported and used. A row that says only
-- who, when and where is a record of a connection, not a QSO; the report
-- exchanged and a line of notes are what make it one.
--
-- One row per contact PER MEMBER: what I sent and what I copied are my own
-- account of the contact, and the other station keeps theirs. They should
-- agree, and when they do not, that is information too.
CREATE TABLE contact_notes (
  contact_id  BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  member_id   BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  rst_sent    TEXT NOT NULL DEFAULT '',
  rst_rcvd    TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, member_id)
);
