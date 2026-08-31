-- The log collapsed identical checks into one line, which was right, and it did
-- it after paginating, which was not. `demo.karlos.dev` has 137 events, of which
-- 4 are moments — the claim, the verification, the rest. Every one of the newest
-- 25 is a routine check, so they collapsed into a single entry and the page
-- rendered exactly one row: "Checked 25 times, nothing changed". The claim and
-- the verification were five pages back, behind nothing.
--
-- At one sweep every 30 seconds that is 2,880 rows a day, so no page size fixes
-- this. The collapsing has to happen before the limit, which means in SQL.
--
-- Gaps and islands: walk the events newest first and start a new run whenever
-- the row is not a routine check, or its status differs from the one before it.
-- Every non-routine row is therefore its own run of one.

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
-- Deliberately not SECURITY DEFINER: `audit_owner_select` already restricts
-- audit_events to its owner, and an invoker-rights function keeps that true
-- instead of re-implementing it.
security invoker
set search_path = ''
as $$
  with scoped as (
    select e.id, e.at, e.kind, e.actor, e.level, e.from_status, e.to_status, e.evidence,
           (e.kind = 'check_completed') as routine
      from public.audit_events e
     where e.domain_id = p_domain_id
       and (p_before is null
            or e.at < p_before
            or (e.at = p_before and e.id < coalesce(p_before_id, 9223372036854775807)))
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
    case when bool_and(g.routine) and count(*) > 1 then 'watch' else 'moment' end as entry_kind,
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

comment on function public.audit_timeline is
  'The log as entries rather than rows: consecutive identical checks collapse into one watch before the limit applies, so a page cannot be spent entirely on routine.';
