import {
  USER_LOOKUP_BUDGET,
  at,
  budgetWindowStart,
  parseClaim,
} from '@deed/core'
import { countLookups, recordLookup } from '@deed/db'
import { preflight } from '@deed/dns'
import { randomProbeLabel } from '@deed/dns'
import { session } from '@/lib/session'
import { refusalMessage } from '@/lib/refusal'
import { router } from '@/lib/verification'

export const dynamic = 'force-dynamic'

/**
 * What we can tell the user about their zone before they have a token to get
 * wrong (prd §3.2). The client debounces to typing pauses; this endpoint is
 * what makes that safe to do — every call is a real lookup against shared
 * public resolvers, so it is charged to the same hourly budget as a manual
 * check (state-model §5).
 */
export async function GET(request: Request): Promise<Response> {
  const current = await session()
  if (current === null) return new Response(null, { status: 401 })

  const name = new URL(request.url).searchParams.get('name') ?? ''
  const parsed = parseClaim(name)
  // A refusal here is about the name, not the zone: there is nothing to look up.
  if (!parsed.ok) {
    return Response.json({ ok: false, reason: refusalMessage(parsed.error, name) })
  }

  const now = at(Date.now())
  const spent = await countLookups(current.db, current.userId, budgetWindowStart(now))
  if (spent >= USER_LOOKUP_BUDGET) {
    // Out of budget is not a verdict about the zone, and must not read as one.
    return Response.json({ ok: false, reason: 'skipped', budget: USER_LOOKUP_BUDGET })
  }
  await recordLookup(current.db, current.userId, 'preflight', null)

  const port = await router(current.db)(parsed.value.name)
  const found = await preflight(port, parsed.value.name, {
    now,
    probeLabel: randomProbeLabel(),
    timeoutMs: 3_000,
  })

  return Response.json({ ok: true, ...found, unicode: parsed.value.unicode })
}
