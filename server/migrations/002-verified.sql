-- RFP §8: "Licensed members claim their real callsign. It must be unique
-- across the system and verified by an administrator before it becomes
-- active, otherwise members will enter callsigns belonging to other
-- operators."
--
-- Verification is a column, not a role: a member's callsign is either
-- confirmed by an administrator or it is not. A training identifier needs no
-- confirmation (the application issued it), and the configured
-- administrator's own callsign is taken as confirmed. Every other callsign
-- registered before this migration is marked unconfirmed, so the rule holds
-- for the accounts that already exist — one click each on the admin page.
ALTER TABLE members ADD COLUMN verified BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE members SET verified = TRUE WHERE training OR role = 'admin';

-- Who dealt with a report, and when. NULL while it is open.
ALTER TABLE reports ADD COLUMN resolved_by BIGINT REFERENCES members(id);
ALTER TABLE reports ADD COLUMN resolved_at TIMESTAMPTZ;
