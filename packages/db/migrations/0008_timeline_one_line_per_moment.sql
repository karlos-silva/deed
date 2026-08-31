-- One instant was rendering as three lines. A check that finds a change writes
-- `check_completed`, plus a record-level `state_changed`, plus a claim-level
-- one — all at the same timestamp, all with the same evidence. To the reader
-- that is one thing: it verified. The other two are the state model talking to
-- itself.
--
-- state-model §6 requires `check_completed` to be *emitted* even when nothing
-- changed, because "we looked and it held" is the freshness claim. It says
-- nothing about rendering one line per row, and the runs already carry that
-- claim ("Checked 123 times — still verified"). S6 asks for a log that stays
-- readable as it grows, which is this.
--
-- Nothing is deleted. Every row is still in the ledger and still returned by
-- listAudit; this changes which of them earn a line.

create or replace function public.audit_timeline(
  p_domain_id uuid,
  p_limit     integer default 20,
  p_before    timestamptz default null,
  p_before_id bigint default null
)
returns table (
  entry_kind  text,
  id          bigint,
  at          timestamptz,
  oldest_at   timestamptz,
  oldest_id   bigint,
  runs        integer,
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
    select e.id, e.at, e.kind, e.actor, e.level, e.from_status, e.to_status, e.evidence,
           (e.kind = 'check_completed') as routine
      from public.audit_events e
     where e.domain_id = p_domain_id
       and (p_before is null
            or e.at < p_before
            or (e.at = p_before and e.id < coalesce(p_before_id, 9223372036854775807)))
  ),
  moments as (
    select b.* from base b
     where not b.routine

       -- The first reading is not a change. Going from "we have not looked" to
       -- a first answer tells the reader nothing happened — only that we
       -- started. The run underneath already says what we found.
       and not (b.kind = 'state_changed' and b.from_status = 'unchecked')

       -- One instant, one line. When the claim moved, that is the headline;
       -- the record transition written in the same transaction is the same
       -- news a second time, in the model's vocabulary rather than the
       -- reader's. A record change with no claim change still stands alone.
       and not (b.kind = 'state_changed' and b.level = 'record' and exists (
         select 1 from base c
          where c.at = b.at and c.kind = 'state_changed' and c.level = 'claim'))
  ),
  scoped as (
    select * from moments
     union all
    -- The check that found a change is that change's mechanism, not a second
    -- event: if a line already stands at this instant, it has been reported.
    select b.* from base b
     where b.routine
       and not exists (select 1 from moments m where m.at = b.at)
  ),
  flagged as (
    select s.*,
           case
             when s.routine
              and lag(s.routine) over w is true
              and lag(s.to_status) over w is not distinct from s.to_status
             then 0 else 1
           end as starts
      from scoped s
    window w as (order by s.at desc, s.id desc)
  ),
  grouped as (
    select f.*,
           sum(f.starts) over (order by f.at desc, f.id desc
                               rows between unbounded preceding and current row) as run
      from flagged f
  )
  select
    -- A routine check never earns a line of its own, however short its run:
    -- the check is the mechanism, and the transition beside it is the event.
    case when bool_and(g.routine) then 'watch' else 'moment' end as entry_kind,
    (array_agg(g.id          order by g.at desc, g.id desc))[1] as id,
    max(g.at)                                                   as at,
    min(g.at)                                                   as oldest_at,
    (array_agg(g.id          order by g.at asc,  g.id asc))[1]  as oldest_id,
    count(*)::integer                                           as runs,
    (array_agg(g.kind        order by g.at desc, g.id desc))[1] as kind,
    (array_agg(g.actor       order by g.at desc, g.id desc))[1] as actor,
    (array_agg(g.level       order by g.at desc, g.id desc))[1] as level,
    (array_agg(g.from_status order by g.at desc, g.id desc))[1] as from_status,
    (array_agg(g.to_status   order by g.at desc, g.id desc))[1] as to_status,
    (array_agg(g.evidence    order by g.at desc, g.id desc))[1] as evidence
    from grouped g
   group by g.run
   order by max(g.at) desc, (array_agg(g.id order by g.at desc, g.id desc))[1] desc
   limit p_limit;
$$;

revoke all on function public.audit_timeline from public, anon;
grant execute on function public.audit_timeline to authenticated;
