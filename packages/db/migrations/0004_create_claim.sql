-- Claim creation, as one transaction that also writes its own audit event.
--
-- `audit_events` has a SELECT policy and deliberately no INSERT policy: the log
-- is the product's "show your work" surface (prd §3), and a history the client
-- can write is a history worth nothing. Every event therefore comes from trusted
-- code — `apply_transition` for transitions, and this for the first one.
--
-- It also closes an atomicity hole. Creating the claim and logging its creation
-- were two separate writes, so a failure between them left a domain that exists
-- with no record of being created — breaking invariant 5, which says every
-- transition emits exactly one audit event. That is not hypothetical: it is the
-- state the first real claim ended up in.

create or replace function public.create_claim(
  p_name          text,
  p_is_sandbox    boolean,
  p_ownership     jsonb,
  p_now           timestamptz,
  p_next_check_at timestamptz
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
  -- SECURITY DEFINER, so the caller's identity is checked rather than assumed.
  -- A claim belongs to whoever is signed in, and to nobody otherwise (D1).
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
    (v_domain.id, v_owner, p_name, p_now, 'claim_created', 'user', null, null, 'pending', null);

  return v_domain;
end;
$$;

revoke all on function public.create_claim from public, anon;
grant execute on function public.create_claim to authenticated;

comment on function public.create_claim is
  'The only way a claim is created. SECURITY DEFINER because audit_events has no INSERT policy on purpose — the log is not client-writable.';
