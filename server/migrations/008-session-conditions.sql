-- 008: the conditions a session was worked at (RFD A39)
--
-- Receive drills may now be practised against fading, static, a second
-- station and a hand at the key. Sessions worked that way score lower than
-- clean ones, and until this column they were counted into the same
-- figures — so a member who switched conditions on would appear, in their
-- own progress report, to be getting worse.
--
-- The maintainer settled this on the sixteenth of October: "the figures are
-- to be honest rather than convenient, and a member who practises against
-- static should not be shown a decline that is an artefact of their own
-- choice."
--
-- 'off' as the default is not a convenience either. Every session recorded
-- before this release WAS worked clean, because there was no other kind, so
-- backfilling them as 'off' states a fact rather than a guess.
ALTER TABLE training_sessions
  ADD COLUMN conditions TEXT NOT NULL DEFAULT 'off';

-- Three values and no others. A free TEXT column here would be read back by
-- a report that groups on it, and one client sending 'Mild' instead of
-- 'mild' would split a member's history into two silent halves.
ALTER TABLE training_sessions
  ADD CONSTRAINT training_sessions_conditions_known
  CHECK (conditions IN ('off', 'mild', 'strong'));
