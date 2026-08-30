import { serviceDb } from '@deed/db'

export const dynamic = 'force-dynamic'

/**
 * Which configuration is present, and whether Postgres answers.
 *
 * It reports presence only — never a value — so it is safe to leave reachable,
 * and it turns "the deployment 500s" into a sentence naming the variable that is
 * missing. A product whose whole subject is diagnosing misconfiguration should
 * be able to diagnose its own.
 *
 * It also doubles as the uptime probe D10 asks for: the `select` is real, so a
 * pinger hitting this keeps a free Supabase project genuinely active rather than
 * just warming a static page.
 */
export async function GET(): Promise<Response> {
  const present = (name: string): boolean => {
    const value = process.env[name]
    return value !== undefined && value !== ''
  }

  const config = {
    NEXT_PUBLIC_SUPABASE_URL: present('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: present('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    SUPABASE_SECRET_KEY: present('SUPABASE_SECRET_KEY'),
    SWEEP_SECRET: present('SWEEP_SECRET'),
    NEXT_PUBLIC_SITE_URL: present('NEXT_PUBLIC_SITE_URL'),
  }

  const missing = Object.entries(config)
    .filter(([, ok]) => !ok)
    .map(([name]) => name)

  let database: string
  try {
    const { error } = await serviceDb().from('sweep_runs').select('id').limit(1)
    database = error === null ? 'ok' : `error: ${error.message}`
  } catch (error) {
    database = `unreachable: ${error instanceof Error ? error.message : 'unknown'}`
  }

  // `NEXT_PUBLIC_SITE_URL` is optional — the app falls back to the request's own
  // host — so its absence is reported without failing the check.
  const required = missing.filter((name) => name !== 'NEXT_PUBLIC_SITE_URL')
  const ok = required.length === 0 && database === 'ok'

  return Response.json(
    { ok, database, config, missing, hint: hintFor(required, database) },
    { status: ok ? 200 : 503 },
  )
}

function hintFor(missing: string[], database: string): string | undefined {
  if (missing.includes('NEXT_PUBLIC_SUPABASE_URL') || missing.includes('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')) {
    return 'NEXT_PUBLIC_* variables are inlined at build time. Setting them after a deploy does nothing until you redeploy.'
  }
  if (missing.includes('SUPABASE_SECRET_KEY')) {
    return 'The sweep and this check read the database with no session, which RLS cannot express. Set the Supabase secret API key — never with a NEXT_PUBLIC_ prefix.'
  }
  if (missing.includes('SWEEP_SECRET')) {
    return 'Without it /api/sweep refuses every caller, including pg_cron, so background re-checks never run.'
  }
  if (database !== 'ok') {
    return 'Configuration looks complete, so this is the database itself — a paused free project is the usual cause (D10).'
  }
  return undefined
}
