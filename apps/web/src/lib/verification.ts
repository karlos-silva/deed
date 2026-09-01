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

export const now = (): Timestamp => at(Date.now())

export function router(db: Db) {
  return createRouter({
    loadZone: async (name) => {
      // The zone is keyed by domain id, and a sandbox name is unique among live claims.
      const { data } = await db.from('domains').select('id').eq('name', name).limit(1).maybeSingle()
      if (data === null) return null
      const zone = await loadZone(db, data.id as Domain['id'])
      return zone === null ? null : (zone as SandboxZone)
    },
  })
}

export type CheckOutcome =
  | {
      readonly status: 'applied'
      readonly stored: StoredDomain
      /**
       * This check is the one that proved it. prd §6.5 asks for one celebratory
       * moment, and it has to fire on the transition rather than on a clock:
       * `AutoRefresh` re-renders every 20–45s, so a "verified in the last
       * minute" window would replay the animation two or three times and "once
       * per lifecycle" would become a loop.
       */
      readonly justVerified: boolean
    }
  /** Somebody else wrote first. Their observation stands; ours is discarded. */
  | { readonly status: 'raced'; readonly stored: StoredDomain }
  | { readonly status: 'gone' }

// The write goes through `apply_transition`: per-domain lock plus audit events (state-model §4, invariant 8).
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
  if (events.length === 0) return { status: 'applied', stored: read, justVerified: false }

  const result = await applyTransition(db, read, next, events, clock)
  if (result.applied) {
    // A check never changes list membership, so it carries the flag through.
    return {
      status: 'applied',
      stored: { domain: next, version: result.version, hiddenAt: read.hiddenAt },
      justVerified: events.some(
        (event) =>
          event.kind === 'state_changed' && event.level === 'claim' && event.to === 'verified',
      ),
    }
  }

  const fresh = await getDomain(db, read.domain.id)
  return fresh === null ? { status: 'gone' } : { status: 'raced', stored: fresh }
}

// Lazy revalidation on read (D5, mechanism 1); the sweep covers the tabs nobody has open.
export async function revalidateIfDue(
  db: Db,
  stored: StoredDomain,
  clock: Timestamp = now(),
): Promise<StoredDomain & { justVerified: boolean }> {
  const due = stored.domain.nextCheckAt
  if (due === null || due > clock) return { ...stored, justVerified: false }
  const outcome = await runCheck(db, stored, 'system', clock)
  if (outcome.status === 'gone') return { ...stored, justVerified: false }
  // The render that performed the transition is the render that celebrates.
  return {
    ...outcome.stored,
    justVerified: outcome.status === 'applied' && outcome.justVerified,
  }
}
