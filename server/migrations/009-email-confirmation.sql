-- RFD A55: a member confirms that the email address on their account is
-- theirs, and the administrator is told by mail when someone registers and
-- again when they have confirmed.
--
-- A separate column from `verified`, which is the administrator's
-- confirmation of a claimed callsign (002). The two answer different
-- questions: "does this address reach this person?" and "is this callsign
-- really theirs?" A training identifier needs no administrator, but its
-- address still needs confirming.
--
-- Members who registered before this migration are marked unconfirmed:
-- nothing proves their addresses either. Nothing is withheld from them for
-- it; the application asks them to confirm and offers to send the link.
-- The administrator's own account is taken as confirmed.
ALTER TABLE members ADD COLUMN email_confirmed BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE members SET email_confirmed = TRUE WHERE role = 'admin';

-- One row per link sent. Same shape and rules as password_resets: only the
-- hash of the token is kept, only the newest link for a member works, and a
-- link works once.
CREATE TABLE email_confirmations (
  token_hash  TEXT PRIMARY KEY,
  member_id   BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX email_confirmations_member ON email_confirmations(member_id);
