import { at } from '@deed/core'
import { claimsDue, recordSweep, serviceDb } from '@deed/db'
import { runCheck } from '@/lib/verification'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// `pg_cron` posts here every minute; runs every claim due under the cadence table (state-model §5).
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

  // Sequential on purpose: a burst of parallel DoH queries gets us rate limited, and a throttled lookup concludes nothing.
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

