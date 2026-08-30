import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

/**
 * A real Postgres, with the three Supabase primitives our policies actually
 * depend on, and nothing else.
 *
 * The delivery plan says `supabase start` for anything touching RLS, and the
 * reason it says so is sound: for RLS, a mock tests the mock. This runs real
 * Postgres and real policies — it just does not boot the nine other containers
 * `supabase start` brings along. Policy evaluation depends on exactly three
 * things: the `authenticated` / `anon` / `service_role` roles, `auth.uid()`, and
 * the `request.jwt.claims` setting. GoTrue, Kong, Realtime and Studio are not
 * involved in whether a row is visible. Recreating those three takes seconds and
 * runs anywhere Docker does (D17).
 *
 * The same assertions were also run once against the live Supabase project, by
 * hand, which is the cross-check that keeps this harness honest.
 */

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(here, '..', 'migrations')

const CONTAINER = 'deed-test-pg'
const PORT = 54329
const PASSWORD = 'test'

export const TEST_DATABASE_URL = `postgres://postgres:${PASSWORD}@127.0.0.1:${PORT}/postgres`

/**
 * What Supabase puts in place before your first migration runs. `auth.uid()` is
 * reproduced exactly: it reads the `sub` claim out of the request's JWT.
 */
const BOOTSTRAP = `
create extension if not exists pgcrypto;

create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;

create schema if not exists auth;

create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
$$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
`

/** Supabase grants the API roles table access; RLS is what filters it. */
const GRANTS = `
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to service_role;
`

const docker = (...args: string[]): string =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export default async function setup(): Promise<() => Promise<void>> {
  try {
    docker('rm', '-f', CONTAINER)
  } catch {
    // Not running. Nothing to clean up.
  }

  docker(
    'run', '-d', '--name', CONTAINER,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
    '-p', `${PORT}:5432`,
    'postgres:17-alpine',
    // Durability is worthless for a database that lives for one test run, and
    // fsync is most of the wall clock.
    '-c', 'fsync=off', '-c', 'full_page_writes=off',
  )

  await waitForReady()

  const client = new Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  await client.query(BOOTSTRAP)

  // Everything except the sweep schedule, which is pg_cron, pg_net and Vault —
  // three things this harness deliberately does not have, testing a cron
  // expression rather than a policy.
  const migrations = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql') && !file.includes('sweep_schedule'))
    .sort()
  for (const file of migrations) {
    await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  await client.query(GRANTS)
  await client.end()

  process.env['TEST_DATABASE_URL'] = TEST_DATABASE_URL

  return async () => {
    try {
      docker('rm', '-f', CONTAINER)
    } catch {
      // Already gone.
    }
    return Promise.resolve()
  }
}

async function waitForReady(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const ready = spawnSync('docker', ['exec', CONTAINER, 'pg_isready', '-U', 'postgres'], {
      stdio: 'ignore',
    })
    if (ready.status === 0) {
      // `pg_isready` answers before the server finishes its own bootstrap
      // restart, so prove a real connection rather than trusting the probe.
      try {
        const client = new Client({ connectionString: TEST_DATABASE_URL })
        await client.connect()
        await client.end()
        return
      } catch {
        // Still coming up.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Postgres container ${CONTAINER} never became ready`)
}
