-- The Activity tab is gone, and with it the only reader `audit_timeline` had.
-- A verified domain's history said "you claimed it" and "it verified" — two
-- lines the badge and the meta above them already carried — and a claim that
-- was never proven said only that it was claimed. The page answers what the
-- record is and whether it holds; the history was a second answer to a
-- question the first one had already settled.
--
-- The ledger itself does not move. `audit_events` is still written on every
-- check and every transition, still append-only, still owner-scoped, and
-- `listAudit` still reads it. state-model §6 is about what is recorded, not
-- about what has a tab.
--
-- Only the view function goes: keeping a function whose entire purpose was to
-- decide which rows earn a line on a page that no longer exists would be a
-- rule nobody applies.

drop function if exists public.audit_timeline(uuid, integer, timestamptz, bigint);
