-- 006: the course position as a fact of its own (RFD A40)
--
-- Until now the server learned a member's position in the course only as a
-- property of an uploaded session: trainingReport returned
-- MAX(unlocked_count) over training_sessions, and there was no other channel.
--
-- That made the position invisible at exactly the moment it changes. A member
-- passes the examination for a new character, promote() runs, saveProgress()
-- writes it to the browser alone — and nothing tells the server until the
-- NEXT session finishes and is uploaded carrying the higher count. Reported
-- by Mohammad on 16 October 2026: unlocked "A" on an iPhone, and his Safari
-- still showed five characters, because the server still held five.
--
-- The column is the position as the member's own device last reported it,
-- independent of any session. The report returns the greater of this and the
-- session maximum, so a member whose sessions predate this migration loses
-- nothing, and a device that is behind can never drag the position back.

ALTER TABLE training_progress
  ADD COLUMN unlocked INTEGER NOT NULL DEFAULT 0;

-- Backfill from what the sessions already say, so the column means something
-- from the moment it exists rather than reading zero for every member.
UPDATE training_progress p
   SET unlocked = COALESCE((
         SELECT MAX(s.unlocked_count)
           FROM training_sessions s
          WHERE s.member_id = p.member_id
       ), 0);
