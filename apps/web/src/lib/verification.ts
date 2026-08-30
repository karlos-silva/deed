import {
  type AuditActor,
  type Domain,
  type Timestamp,
  at,
  reduce,
} from '@deed/core'
import {
  type StoredDomain,
  type Db,
  applyTransition,
  getDomain,
  loadZone,
} from '@deed/db'
import { type SandboxZone, createRouter, observe, randomProbeLabel } from '@deed/dns'

/**
 * The seam. One pure engine serves the UI, the route handlers, the background
 * sweep and the sandbox (prd §9) — this is the only place a check is run and
 * its result persisted, so none of those four can drift from the others.
 */

export const now = (): Timestamp => at(Date.now())

export function router(db: Db) {
  return createRouter({
    loadZone: async (name) => {
      // The zone is keyed by domain id, and a sandbox name is unique among live
      // claims, so the name is enough to find it.
      const { data } = await db.from('domains').select('id').eq('name', name).limit(1).maybeSingle()
      if (data === null) return null
      const zone = await loadZone(db, data.id as Domain['id'])
      return zone === null ? null : (zone as SandboxZone)
    },
  })
}

export type CheckOutcome =
  | { readonly status: 'applied'; readonly stored: StoredDomain }
  /** Somebody else wrote first. Their observation stands; ours is discarded. */
  | { readonly status: 'raced'; readonly stored: StoredDomain }
  | { readonly status: 'gone' }

/**
 * Run one check and persist what it concluded. The write goes through
 * `apply_transition`, which takes the per-domain lock and commits the state
 * change with its audit events (state-model §4, invariant 8).
 */
export async function runCheck(
  db: Db,
  read: StoredDomain,
  actor: AuditActor,
  clock: Timestamp = now(),
): Promise<CheckOutcome> {
  const port = await router(db)(read.domain.name)
  const observation = await observe(port, read.domain.name, {
    now: clock,
    actor,
    probeLabel: randomProbeLabel(),
  })

  const { next, events } = reduce(read.domain, observation, clock)
  if (events.length === 0) return { status: 'applied', stored: read }

  const result = await applyTransition(db, read, next, events, clock)
  if (result.applied) return { status: 'applied', stored: { domain: next, version: result.version } }

  const fresh = await getDomain(db, read.domain.id)
  return fresh === null ? { status: 'gone' } : { status: 'raced', stored: fresh }
}

/**
 * Lazy revalidation on read (D5, mechanism 1). Loading a domain whose next check
 * is already due runs one now, so an open tab is never staler than the cadence
 * promises — and the sweep is what covers the tabs nobody has open.
 */
export async function revalidateIfDue(
  db: Db,
  stored: StoredDomain,
  clock: Timestamp = now(),
): Promise<StoredDomain> {
  const due = stored.domain.nextCheckAt
  if (due === null || due > clock) return stored
  const outcome = await runCheck(db, stored, 'system', clock)
  return outcome.status === 'gone' ? stored : outcome.stored
}
