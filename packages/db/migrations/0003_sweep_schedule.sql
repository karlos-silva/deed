-- The background sweep (D5).
--
-- Vercel Cron is not usable here: on the Hobby plan it fires roughly once a day,
-- and a grace window measured in hours cannot be honoured by a daily sweep.
-- `pg_cron` is not plan-gated on Supabase and accepts sub-minute intervals, so a
-- one-minute sweep is well within the free tier.
--
-- PREREQUISITE — store the shared secret in Vault first, with the same value set
-- as SWEEP_SECRET in the deployment's environment:
--
--   select vault.create_secret('<the secret>', 'sweep_secret',
--                              'Bearer token pg_cron presents to /api/sweep');
--
-- It goes in Vault rather than inline because `cron.job.command` is plain text
-- readable by anyone with database access, and a secret pasted into a scheduled
-- job is a secret published to every future reader of that table.

create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema extensions;

-- Idempotent: re-running this migration re-points an existing schedule rather
-- than failing or quietly creating a second one.
select cron.unschedule(jobname)
  from cron.job
 where jobname in ('recheck-sweep', 'recheck-sweep-retention', 'sweep-runs-retention');

-- Every 30 seconds, not every minute. The cadence table's fastest tier is 30s,
-- for the window right after a change — the moment a user is actually watching
-- a record propagate. A one-minute schedule cannot honour it, and misses by a
-- hair besides: `next_check_at` carries the sub-second offset of the check that
-- set it, so a job firing at :00.0xx finds a claim due at :00.9xx not yet due
-- and skips a whole minute. Observed doing exactly that on the first real domain.
select cron.schedule(
  'recheck-sweep',
  '30 seconds',
  $$
    select net.http_post(
      url     := 'https://domains.karlos.dev/api/sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization',
        'Bearer ' || (select decrypted_secret
                        from vault.decrypted_secrets
                       where name = 'sweep_secret')
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
  $$
);

-- `cron.job_run_details` is never cleaned up automatically, and a
-- minute-granularity job accumulates rows indefinitely (D5). Keep a week.
select cron.schedule(
  'recheck-sweep-retention',
  '17 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

-- Same reasoning for our own sweep log: it is evidence, not an archive.
select cron.schedule(
  'sweep-runs-retention',
  '23 4 * * *',
  $$ delete from public.sweep_runs where at < now() - interval '14 days' $$
);
