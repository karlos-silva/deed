-- Closing a claim is not the same act as clearing it off your screen, and this
-- product had only the first one. A released domain kept its row forever, with
-- no control anywhere to move it (the detail page's action card is gated on
-- `activeToken`, which is null once a claim is revoked), and it went on
-- consuming one of the account's 25 slots.
--
-- Deleting the row is the obvious fix and the wrong one. `audit_events.domain_id`
-- is `on delete set null` and `listAudit` finds a claim's history by that id, so
-- a delete puts the history permanently out of reach of the one person it was
-- kept for (prd §10). `lookups.domain_id` cascades, so a delete would also hand
-- the account back the hour's rate-limit budget it had already spent.
--
-- So nothing is deleted. `hidden_at` is a fact about the owner's list, not about
-- the claim: it changes no modelled state, and it is legal only once the claim is
-- terminal and can never change again.

alter table public.domains add column hidden_at timestamptz;

alter table public.domains add constraint domains_hidden_is_terminal check (
  hidden_at is null or ownership ->> 'status' in ('expired', 'revoked')
);

comment on column public.domains.hidden_at is
  'When the owner took this closed claim off their list. Presentation only — the row, its state and its log are untouched.';

create index domains_owner_listed on public.domains (owner_id, created_at desc)
  where hidden_at is null;

-- Never used by any code path, and it could only do harm: a signed-in client
-- holding the publishable key could DELETE its own rows through PostgREST,
-- orphaning its log and refunding its rate-limit budget. With it gone, "history
-- survives" is a property of the schema rather than a convention.
drop policy if exists domains_owner_delete on public.domains;

-- 25 *live* claims, not 25 rows: closed claims are never deleted, so counting
-- them would let an account release its way into a permanent lockout with no
-- move left that frees a slot. Because nothing is ever deleted, the rows still
-- need a ceiling of their own (D1, revised).
create or replace function public.enforce_domain_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_live  integer;
  v_total integer;
begin
  select count(*) filter (where ownership ->> 'status' in ('pending', 'verified', 'degraded')),
         count(*)
    into v_live, v_total
    from public.domains
   where owner_id = new.owner_id;

  if v_live >= 25 then
    raise exception 'domain cap reached'
      using errcode = 'check_violation', hint = '25 live claims per account';
  end if;

  if v_total >= 100 then
    raise exception 'history cap reached'
      using errcode = 'check_violation', hint = '100 claims per account, closed ones included';
  end if;

  return new;
end;
$$;

-- Taking a closed claim off the list, and putting it back. Deliberately writes no
-- audit event and does not bump `version`: the log records every check and every
-- state transition (prd §6), and this is neither. It touches no byte of
-- `ownership`, `record`, `supersession`, `next_check_at` or `version`, so it can
-- never race a transition — the two write disjoint columns.
create or replace function public.set_hidden(
  p_domain_id uuid,
  p_hidden    boolean,
  p_now       timestamptz
)
returns public.domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid := (select auth.uid());
  v_domain public.domains%rowtype;
begin
  -- SECURITY DEFINER bypasses RLS, so the caller's identity is checked here.
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_domain from public.domains where id = p_domain_id for update;

  if not found then
    raise exception 'no such domain' using errcode = 'P0002';
  end if;

  if v_domain.owner_id <> v_owner then
    raise exception 'not your domain' using errcode = '42501';
  end if;

  if p_hidden and v_domain.ownership ->> 'status' not in ('expired', 'revoked') then
    raise exception 'a live claim cannot be removed from the list'
      using errcode = 'check_violation', hint = 'release it first';
  end if;

  update public.domains
     set hidden_at = case when p_hidden then p_now else null end
   where id = p_domain_id
  returning * into v_domain;

  return v_domain;
end;
$$;

revoke all on function public.set_hidden from public, anon;
grant execute on function public.set_hidden to authenticated;

comment on function public.set_hidden is
  'Moves a closed claim between the list and Removed. Writes no audit event: a view preference is not a state transition.';

-- Releasing has to revoke the claim and take it off the list in one transaction.
-- Two round trips can fail between them, and the state they would leave behind —
-- revoked, still sitting in the list — is the exact one this feature exists to
-- remove. The parameter is added here rather than in a second RPC so that
-- `apply_transition` stays the one write path for a state change (invariant 8).
--
-- `p_hidden_at` null means "leave it as it is", which is what every existing
-- caller wants; clearing it is `set_hidden(id, false, ...)`.
drop function if exists public.apply_transition(
  uuid, bigint, timestamptz, jsonb, jsonb, jsonb, timestamptz, timestamptz, timestamptz, jsonb);

create function public.apply_transition(
  p_domain_id       uuid,
  p_version         bigint,
  p_now             timestamptz,
  p_ownership       jsonb,
  p_record          jsonb,
  p_supersession    jsonb,
  p_last_checked_at timestamptz,
  p_next_check_at   timestamptz,
  p_last_changed_at timestamptz,
  p_events          jsonb default '[]'::jsonb,
  p_hidden_at       timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain public.domains%rowtype;
  v_role   text := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role', '');
  v_became_verified boolean;
  v_revoked integer := 0;
begin
  -- The per-domain lock. A second writer waits here, then finds its version stale.
  select * into v_domain from public.domains where id = p_domain_id for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'missing');
  end if;

  if v_role <> 'service_role'
     and ((select auth.uid()) is null or (select auth.uid()) <> v_domain.owner_id) then
    raise exception 'not your domain' using errcode = '42501';
  end if;

  if v_domain.version <> p_version then
    return jsonb_build_object('applied', false, 'reason', 'stale',
                              'version', v_domain.version);
  end if;

  v_became_verified :=
    (p_ownership ->> 'status') = 'verified' and (v_domain.ownership ->> 'status') <> 'verified';

  update public.domains
     set ownership       = p_ownership,
         record          = p_record,
         supersession    = p_supersession,
         last_checked_at = p_last_checked_at,
         next_check_at   = p_next_check_at,
         last_changed_at = p_last_changed_at,
         hidden_at       = coalesce(p_hidden_at, v_domain.hidden_at),
         version         = v_domain.version + 1
   where id = p_domain_id;

  insert into public.audit_events
    (domain_id, owner_id, domain_name, at, kind, actor, level, from_status, to_status, evidence)
  select p_domain_id,
         v_domain.owner_id,
         v_domain.name,
         coalesce((e ->> 'at')::timestamptz, p_now),
         e ->> 'kind',
         e ->> 'actor',
         e ->> 'level',
         e ->> 'from',
         e ->> 'to',
         e -> 'evidence'
    from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as e;

  -- When one claim verifies, competing pending claims on the name are revoked (prd §8, D6).
  if v_became_verified then
    with losers as (
      update public.domains d
         set ownership = jsonb_build_object('status', 'revoked', 'reason', 'claimed_by_other'),
             record = d.record,
             next_check_at = null,
             last_changed_at = p_now,
             version = d.version + 1
       where d.name = v_domain.name
         and d.id <> p_domain_id
         and d.ownership ->> 'status' = 'pending'
      returning d.id, d.owner_id, d.name
    )
    insert into public.audit_events
      (domain_id, owner_id, domain_name, at, kind, actor, level, from_status, to_status)
    select l.id, l.owner_id, l.name, p_now, 'state_changed', 'system', 'claim', 'pending', 'revoked'
      from losers l;

    get diagnostics v_revoked = row_count;
  end if;

  return jsonb_build_object(
    'applied', true,
    'version', v_domain.version + 1,
    'revoked_competing', v_revoked
  );
end;
$$;

revoke all on function public.apply_transition from public, anon;
grant execute on function public.apply_transition to authenticated, service_role;

-- `reclaimed` has been in the audit union, the CHECK constraint and the renderer
-- since S7, and nothing ever emitted it. It is the line a re-claim deserves: with
-- closed claims kept as their own rows, claiming a name you held before starts a
-- second, separate history, and the log should say which one this is.
drop function if exists public.create_claim(text, boolean, jsonb, timestamptz, timestamptz);

create function public.create_claim(
  p_name          text,
  p_is_sandbox    boolean,
  p_ownership     jsonb,
  p_now           timestamptz,
  p_next_check_at timestamptz,
  p_again         boolean default false
)
returns public.domains
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid := (select auth.uid());
  v_domain public.domains%rowtype;
begin
  -- SECURITY DEFINER bypasses RLS, so the caller's identity is checked here (D1).
  if v_owner is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.domains
    (owner_id, name, is_sandbox, ownership, record, next_check_at, last_changed_at, created_at)
  values
    (v_owner, p_name, p_is_sandbox, p_ownership, '{"status":"unchecked"}'::jsonb,
     p_next_check_at, p_now, p_now)
  returning * into v_domain;

  insert into public.audit_events
    (domain_id, owner_id, domain_name, at, kind, actor, level, from_status, to_status, evidence)
  values
    (v_domain.id, v_owner, p_name, p_now,
     case when p_again then 'reclaimed' else 'claim_created' end,
     'user', null, null, 'pending', null);

  return v_domain;
end;
$$;

revoke all on function public.create_claim from public, anon;
grant execute on function public.create_claim to authenticated;

comment on function public.create_claim is
  'The only way a claim is created. SECURITY DEFINER because audit_events has no INSERT policy on purpose — the log is not client-writable.';
