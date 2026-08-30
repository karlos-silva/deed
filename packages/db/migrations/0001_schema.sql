-- Schema for Deed.
--
-- The state machine lives in `packages/core` and its states are stored as JSONB
-- exactly as the core defines them (state-model §2, §3). The relational layer
-- holds what SQL is genuinely better at: identity, ownership, ordering, and the
-- two invariants a pure function cannot hold on its own —
--   §4.1  at most one *live* claim per name, and
--   §4.8  transitions for one domain are serialized.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- domains --

create table public.domains (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users (id) on delete cascade,

  -- Punycode, lowercased, no trailing dot (state-model §1).
  name             text not null,
  is_sandbox       boolean not null default false,

  -- OwnershipState, RecordState and Supersession, verbatim from the core.
  ownership        jsonb not null,
  record           jsonb not null default '{"status":"unchecked"}'::jsonb,
  supersession     jsonb,

  last_checked_at  timestamptz,
  next_check_at    timestamptz,
  last_changed_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),

  -- Bumped on every write. A caller that read version N may only write N+1,
  -- so a sweep and a "check now" racing cannot apply a transition to state
  -- neither of them read (§4.8).
  version          bigint not null default 0,

  constraint domains_name_not_empty check (length(name) between 1 and 253),
  constraint domains_ownership_status check (
    ownership ->> 'status' in ('pending', 'verified', 'degraded', 'expired', 'revoked')
  )
);

comment on column public.domains.version is
  'Optimistic concurrency token — see apply_transition (state-model §4, invariant 8).';

-- Pending is deliberately not exclusive: any number of accounts may attempt the
-- same name (prd §8). Only proof is exclusive, and a degraded holder keeps the
-- name for the whole grace window (§4.2).
create unique index domains_one_live_claim_per_name
  on public.domains (name)
  where ownership ->> 'status' in ('verified', 'degraded');

create unique index domains_one_claim_per_owner_per_name
  on public.domains (owner_id, name)
  where ownership ->> 'status' in ('pending', 'verified', 'degraded');

create index domains_owner on public.domains (owner_id, created_at desc);
create index domains_due on public.domains (next_check_at) where next_check_at is not null;

-- 25 domains per account (D1). A cap that lives only in the application is a
-- cap until somebody adds a second write path.
create or replace function public.enforce_domain_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.domains where owner_id = new.owner_id) >= 25 then
    raise exception 'domain cap reached'
      using errcode = 'check_violation', hint = '25 domains per account';
  end if;
  return new;
end;
$$;

create trigger domains_cap
  before insert on public.domains
  for each row execute function public.enforce_domain_cap();

-- ----------------------------------------------------------- audit events --

-- Append-only and immutable (state-model §6). `domain_id` goes null rather than
-- cascading: a revoked claim's history stays readable to its former holder,
-- because the log records what *they* did and saw (prd §10).
create table public.audit_events (
  id          bigint generated always as identity primary key,
  domain_id   uuid references public.domains (id) on delete set null,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  domain_name text not null,
  at          timestamptz not null,
  kind        text not null,
  actor       text not null,
  level       text,
  from_status text,
  to_status   text,
  evidence    jsonb,

  constraint audit_kind check (
    kind in ('claim_created', 'check_completed', 'state_changed',
             'token_rotated', 'released', 'reclaimed')
  ),
  constraint audit_actor check (actor in ('user', 'sweep', 'system')),
  constraint audit_level check (level is null or level in ('claim', 'record'))
);

-- Newest first, and paginated: a domain checked every six hours for a month is
-- still a page, not a download (S6). Superseded by 0005 — the index has to lead
-- with `owner_id`, because that is what the RLS policy filters on.
create index audit_by_domain on public.audit_events (domain_id, at desc, id desc);
create index audit_by_owner on public.audit_events (owner_id, at desc);

-- ---------------------------------------------------------- sandbox zones --

-- The visitor's instrument (D2). One JSONB document, edited by pure functions
-- in `packages/dns`, so the whole zone replays in a test with no clock.
create table public.sandbox_zones (
  domain_id uuid primary key references public.domains (id) on delete cascade,
  owner_id  uuid not null references auth.users (id) on delete cascade,
  zone      jsonb not null,
  version   bigint not null default 0
);

-- ------------------------------------------------------------ rate limits --

-- Rate limits are product surface, not infrastructure trivia (state-model §5):
-- the refusal shows the time remaining, so the attempts have to be readable.
create table public.lookups (
  id        bigint generated always as identity primary key,
  owner_id  uuid not null references auth.users (id) on delete cascade,
  domain_id uuid references public.domains (id) on delete cascade,
  kind      text not null,
  at        timestamptz not null default now(),

  constraint lookups_kind check (kind in ('check_now', 'preflight', 'claim'))
);

create index lookups_by_owner on public.lookups (owner_id, at desc);
create index lookups_by_domain on public.lookups (domain_id, at desc);

-- -------------------------------------------------------------- the sweep --

-- Proof the background mechanism runs with nobody watching (S0, S6), and the
-- real table write that keeps a free project from being paused for inactivity
-- (D5, D10).
create table public.sweep_runs (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  due       integer not null default 0,
  checked   integer not null default 0,
  failed    integer not null default 0,
  detail    text
);

create index sweep_runs_recent on public.sweep_runs (at desc);

-- --------------------------------------------------------------- security --

alter table public.domains        enable row level security;
alter table public.audit_events   enable row level security;
alter table public.sandbox_zones  enable row level security;
alter table public.lookups        enable row level security;
alter table public.sweep_runs     enable row level security;

-- One predicate, because sign-in is always a real identity (D1). A policy that
-- denies everyone would pass every isolation test and ship a broken product, so
-- the owner's own access is asserted too (S3).
create policy domains_owner_select on public.domains
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy domains_owner_insert on public.domains
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy domains_owner_update on public.domains
  for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy domains_owner_delete on public.domains
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- Append-only: no update policy, no delete policy, ever.
create policy audit_owner_select on public.audit_events
  for select to authenticated using ((select auth.uid()) = owner_id);

create policy zones_owner_all on public.sandbox_zones
  for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

create policy lookups_owner_select on public.lookups
  for select to authenticated using ((select auth.uid()) = owner_id);

-- The freshness of the sweep is a product claim, so it is readable. Nothing in
-- it is anyone's data.
create policy sweep_read on public.sweep_runs
  for select to authenticated using (true);
