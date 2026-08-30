-- The audit index has to match the query RLS actually produces.
--
-- `audit_by_domain (domain_id, at desc, id desc)` looks exactly right, and is
-- unusable. Every real read carries the policy predicate `auth.uid() = owner_id`
-- as a security-barrier filter, so the planner enters through `owner_id`,
-- filters `domain_id` afterwards, and then sorts — turning a 25-row page into a
-- scan of everything the account has ever done. S6 asks for the opposite in so
-- many words: the log is paginated, and the page renders without loading every
-- event.
--
-- Leading with `owner_id` lets the policy predicate and the domain filter both
-- be index conditions, with `at desc, id desc` supplying the order for free.
--
-- Only visible against real Postgres with RLS on. As superuser the original
-- index plans beautifully, which is precisely why D12 refuses to mock this.

drop index if exists public.audit_by_domain;
drop index if exists public.audit_by_owner;

create index audit_by_owner_domain
  on public.audit_events (owner_id, domain_id, at desc, id desc);
