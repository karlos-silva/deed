-- The background sweep (D5), on pg_cron.
--
-- PREREQUISITE — store the secret in Vault first, matching SWEEP_SECRET in the
-- environment; `cron.job.command` is plain text readable by anyone with database
-- access, so it cannot be inlined:
--   select vault.create_secret('<the secret>', 'sweep_secret',
--                              'Bearer token pg_cron presents to /api/sweep');

create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema extensions;

-- Idempotent: re-running re-points an existing schedule rather than adding a second.
select cron.unschedule(jobname)
  from cron.job
 where jobname in ('recheck-sweep', 'recheck-sweep-retention', 'sweep-runs-retention');

-- 30s, not 1m: `next_check_at` keeps the sub-second offset of the check that set
-- it, so a minute-granularity job skips a claim due at :00.9xx for a whole minute.
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

-- `cron.job_run_details` is never cleaned up automatically (D5). Keep a week.
select cron.schedule(
  'recheck-sweep-retention',
  '17 4 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);

select cron.schedule(
  'sweep-runs-retention',
  '23 4 * * *',
  $$ delete from public.sweep_runs where at < now() - interval '14 days' $$
);
