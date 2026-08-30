-- The claim and its first audit event in one transaction; `audit_events` has no
-- INSERT policy, so the event has to be written by trusted code (prd §3).

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
    (v_domain.id, v_owner, p_name, p_now, 'claim_created', 'user', null, null, 'pending', null);

  return v_domain;
end;
$$;

revoke all on function public.create_claim from public, anon;
grant execute on function public.create_claim to authenticated;

comment on function public.create_claim is
  'The only way a claim is created. SECURITY DEFINER because audit_events has no INSERT policy on purpose — the log is not client-writable.';
