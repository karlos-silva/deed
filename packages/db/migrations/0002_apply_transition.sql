-- The one write path for a state transition: per-domain lock, with the state
-- change and its audit events in one transaction (state-model §4.8).

create or replace function public.apply_transition(
  p_domain_id       uuid,
  p_version         bigint,
  p_now             timestamptz,
  p_ownership       jsonb,
  p_record          jsonb,
  p_supersession    jsonb,
  p_last_checked_at timestamptz,
  p_next_check_at   timestamptz,
  p_last_changed_at timestamptz,
  p_events          jsonb default '[]'::jsonb
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

-- Oldest first, so a backlog drains fairly rather than starving one domain (D5).
create or replace function public.claims_due(p_now timestamptz, p_limit integer default 50)
returns setof public.domains
language sql
security definer
set search_path = ''
as $$
  select * from public.domains
   where next_check_at is not null
     and next_check_at <= p_now
   order by next_check_at asc
   limit p_limit;
$$;

revoke all on function public.claims_due from public, anon, authenticated;
grant execute on function public.claims_due to service_role;
