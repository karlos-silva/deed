-- The audit index has to lead with `owner_id`: RLS adds `auth.uid() = owner_id` as a
-- security-barrier filter, so an index led by `domain_id` is never entered (S6).

drop index if exists public.audit_by_domain;
drop index if exists public.audit_by_owner;

create index audit_by_owner_domain
  on public.audit_events (owner_id, domain_id, at desc, id desc);
