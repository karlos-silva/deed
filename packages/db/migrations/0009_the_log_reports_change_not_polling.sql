-- A run of identical checks was still earning a line: "Checked 156 times —
-- still verified". It answers a question nobody asked. Whether we are still
-- polling is our business; the log is for what changed, and when nothing
-- changed there is nothing to report. Freshness already has a home — the
-- record panel's "Last checked" — and it is one field, not a paragraph.
--
-- So `check_completed` never earns a line. state-model §6 still holds: the
-- events are emitted, stored, immutable, and returned by `listAudit`. This
-- decides what is *shown*, and nothing else.
--
-- One rule had to come back. 0008 dropped the first record transition out of
-- `unchecked` because "the run underneath already says what we found" — and
-- there is no run underneath any more. Left alone, a first check that found a
-- wrong value, a broken zone, or our own lookup failing would have produced a
-- log with nothing in it but the claim. A first reading that names a fault is
-- news; a first reading of "not there yet" is the state we just told them to
-- expect, so that one still stays out.

drop function if exists public.audit_timeline(uuid, integer, timestamptz, bigint);

create function public.audit_timeline(
  p_domain_id uuid,
  p_limit     integer default 20,
  p_before    timestamptz default null,
  p_before_id bigint default null
)
returns table (
  id          bigint,
  at          timestamptz,
  kind        text,
  actor       text,
  level       text,
  from_status text,
  to_status   text,
  evidence    jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select e.id, e.at, e.kind, e.actor, e.level, e.from_status, e.to_status, e.evidence
      from public.audit_events e
     where e.domain_id = p_domain_id
       and (p_before is null
            or e.at < p_before
            or (e.at = p_before and e.id < coalesce(p_before_id, 9223372036854775807)))
  )
  select b.id, b.at, b.kind, b.actor, b.level, b.from_status, b.to_status, b.evidence
    from base b
   where b.kind <> 'check_completed'

     -- The first reading is only news when it names a fault. Going from "we
     -- have not looked" to "not there yet" is the state the instructions
     -- already described.
     and not (b.kind = 'state_changed'
              and b.from_status = 'unchecked'
              and coalesce(b.to_status, '') not in ('mismatch', 'zone_error', 'check_failed'))

     -- One instant, one line. When the claim moved, that is the headline; the
     -- record transition written in the same transaction is the same news a
     -- second time, in the model's vocabulary rather than the reader's. A
     -- record change with no claim change still stands alone.
     and not (b.kind = 'state_changed' and b.level = 'record' and exists (
       select 1 from base c
        where c.at = b.at and c.kind = 'state_changed' and c.level = 'claim'))

   order by b.at desc, b.id desc
   limit p_limit;
$$;

revoke all on function public.audit_timeline from public, anon;
grant execute on function public.audit_timeline to authenticated;
