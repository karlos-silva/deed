-- `Check now` returned 500 for every user, every time, since the beginning.
--
-- 0001 gave `lookups` row-level security and exactly one policy —
-- `lookups_owner_select`. RLS denies what no policy allows, so the INSERT in
-- `recordLookup` was refused for anyone but the service role: PostgREST
-- answered 403, `recordLookup` threw, and the server component's render died
-- with it. The user saw the error boundary. Production's edge log is
-- unambiguous — GET domains 200, GET lookups 200, HEAD lookups 200,
-- `POST /rest/v1/lookups 403`, and the 500 in the same second.
--
-- It never showed up in a test because nothing wrote to `lookups` as a user.
-- The tests that count spend seeded rows as the admin, which is the one role
-- RLS does not apply to. The tests below close that: the owner may insert her
-- own row, may not insert someone else's, and still cannot rewrite or delete
-- what she has written.
--
-- Two things were broken by the same omission, not one. Nothing the user did
-- was ever charged, so `countLookups` and `lastManualCheck` read an empty
-- table: the hourly budget and the check-now cooldown in state-model §5 have
-- been unenforced the whole time. The rows were never being written to enforce
-- them against.
--
-- Insert only, and only your own. There is deliberately still no update and no
-- delete policy: a rate-limit ledger you can rewrite is not one.

create policy lookups_owner_insert on public.lookups
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);
