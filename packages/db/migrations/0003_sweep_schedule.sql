-- The background sweep (D5).
--
-- Apply this once the app has a deployed URL, substituting <APP_URL> and
-- <SWEEP_SECRET>. Vercel Cron is not usable here: on the Hobby plan it fires
-- roughly once a day, and a grace window measured in hours cannot be honoured
-- by a daily sweep.
--
-- `pg_cron` is not plan-gated on Supabase and accepts sub-minute intervals, so
-- a one-minute sweep is well within the free tier.

create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'recheck-sweep',
  '* * * * *',
  $$
    select net.http_post(
      url     := '<APP_URL>/api/sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SWEEP_SECRET>'
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
