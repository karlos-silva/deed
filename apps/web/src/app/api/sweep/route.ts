import { at } from '@deed/core'
import { claimsDue, recordSweep, serviceDb } from '@deed/db'
import { runCheck } from '@/lib/verification'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * The sweep (D5, mechanism 2). `pg_cron` posts here every minute; this reads
 * every claim whose next check is due under the cadence table (state-model §5)
 * and runs it.
 *
 * It exists so verification keeps happening with nobody watching — which is the
 * difference between a product that claims continuous verification and one that
 * performs it. It also writes a real row every run, so the free project keeps
 * seeing genuine database activity (D5, D10).
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env['SWEEP_SECRET']
  const offered = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (secret === undefined || secret === '' || offered !== secret) {
    return new Response('forbidden', { status: 403 })
  }

  const db = serviceDb()
  const clock = at(Date.now())
  const due = await claimsDue(db, clock)

  let checked = 0
  let failed = 0
  const problems: string[] = []

  // Sequential on purpose: a burst of parallel DoH queries is the fastest way
  // to get rate limited by the resolvers we depend on, and a throttled lookup
  // is our failure — it would conclude nothing and waste the sweep.
  for (const stored of due) {
    try {
      await runCheck(db, stored, 'sweep', at(Date.now()))
      checked += 1
    } catch (error) {
      failed += 1
      problems.push(`${stored.domain.name}: ${error instanceof Error ? error.message : 'failed'}`)
    }
  }

  await recordSweep(db, {
    due: due.length,
    checked,
    failed,
    ...(problems.length > 0 ? { detail: problems.slice(0, 5).join('; ') } : {}),
  })

  return Response.json({ due: due.length, checked, failed })
}

/** A cheap liveness probe that touches Postgres, so an uptime pinger keeps the free project awake (D10). */
export async function GET(): Promise<Response> {
  const db = serviceDb()
  const { error } = await db.from('sweep_runs').select('id').limit(1)
  return error === null
    ? Response.json({ ok: true })
    : Response.json({ ok: false, error: error.message }, { status: 503 })
}
