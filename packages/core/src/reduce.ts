import type { AuditEvent } from './model/audit'
import type { Domain, OwnershipState } from './model/domain'
import type { Observation } from './model/observation'
import type { DegradedCause, RecordState } from './model/record'
import { deriveRecord } from './derive/record'
import type { Expectation } from './derive/classify'
import { nextCheckFrom } from './cadence'
import { OWNERSHIP_GRACE, type Timestamp, plus } from './time'

export type Reduction = { readonly next: Domain; readonly events: readonly AuditEvent[] }

/**
 * Total and exhaustive over the union (state-model §6): no `default:` branch anywhere.
 * Time-based transitions are evaluated from `now`, so the sweep makes them *timely*, never *correct*.
 */
export function reduce(state: Domain, observation: Observation, now: Timestamp): Reduction {
  const record = deriveRecord(observation, expectationOf(state, now), state.record)

  if (record.status === 'unchecked') return { next: state, events: [] }

  const ownership = advanceClaim(state, record, now)

  // Invariant 6: if we could not look we conclude nothing, clocks and stored record included.
  const conclusive = record.status !== 'check_failed'
  const recordChanged = conclusive && state.record.status !== record.status
  const claimChanged = state.ownership.status !== ownership.status

  // Emitted even when nothing changed: "we looked and it held" is the freshness claim.
  const events: AuditEvent[] = [
    {
      domainId: state.id,
      at: now,
      kind: 'check_completed',
      actor: observation.actor,
      to: record.status,
      evidence: observation,
    },
  ]

  // Invariant 5: one audit event per level that actually moved, carrying its evidence.
  if (recordChanged) {
    events.push({
      domainId: state.id,
      at: now,
      kind: 'state_changed',
      actor: observation.actor,
      level: 'record',
      from: state.record.status,
      to: record.status,
      evidence: observation,
    })
  }
  if (claimChanged) {
    events.push({
      domainId: state.id,
      at: now,
      kind: 'state_changed',
      actor: observation.actor,
      level: 'claim',
      from: state.ownership.status,
      to: ownership.status,
      evidence: observation,
    })
  }

  const changed = recordChanged || claimChanged
  const withState: Domain = {
    ...state,
    ownership,
    record: conclusive ? record : state.record,
    lastCheckedAt: conclusive ? now : state.lastCheckedAt,
    lastChangedAt: changed ? now : state.lastChangedAt,
  }

  return { next: { ...withState, nextCheckAt: nextCheckFrom(withState, now) }, events }
}

/** The current token, plus anything rotated out and still inside its bound (state-model §3). */
export function expectationOf(state: Domain, now: Timestamp): Expectation {
  const superseded =
    state.supersession !== null && now < state.supersession.honourUntil
      ? [state.supersession.previousToken]
      : []
  return { domain: state.name, current: tokenOf(state.ownership), superseded }
}

const tokenOf = (ownership: OwnershipState) => {
  switch (ownership.status) {
    case 'pending':
    case 'verified':
    case 'degraded':
      return ownership.token
    case 'expired':
    case 'revoked':
      return null
  }
}

/** The record→claim table of state-model §2, in the order the table states it. */
function advanceClaim(state: Domain, record: RecordState, now: Timestamp): OwnershipState {
  const claim = state.ownership

  switch (claim.status) {
    case 'pending': {
      if (record.status === 'verified') {
        return { status: 'verified', token: claim.token, verifiedAt: now }
      }
      // Expiring an unproven claim takes nothing away, so it needs no conclusive evidence.
      if (now >= claim.expiresAt) return { status: 'expired', claimedAt: claim.claimedAt }
      return claim
    }

    case 'verified': {
      const cause = degradationCause(record)
      if (cause === null) return claim
      return {
        status: 'degraded',
        token: claim.token,
        verifiedAt: claim.verifiedAt,
        degradedAt: now,
        revokesAt: plus(now, OWNERSHIP_GRACE),
        cause,
      }
    }

    case 'degraded': {
      if (record.status === 'verified') {
        return { status: 'verified', token: claim.token, verifiedAt: now }
      }
      const cause = degradationCause(record)
      // A week of our own failed lookups is our outage, not their abandonment (invariant 6).
      if (cause !== null && now >= claim.revokesAt) {
        return { status: 'revoked', reason: 'grace_expired' }
      }
      return cause === null || cause === claim.cause ? claim : { ...claim, cause }
    }

    case 'expired':
    case 'revoked':
      return claim
  }
}

/** Quorum is the bar for *gaining* verification, not for keeping it: `propagating` never degrades a verified claim. */
function degradationCause(record: RecordState): DegradedCause | null {
  switch (record.status) {
    case 'absent':
      return 'record_missing'
    case 'mismatch':
      return record.cause
    case 'zone_error':
      return 'zone_failing'
    case 'verified':
    case 'propagating':
    case 'check_failed':
    case 'unchecked':
      return null
  }
}
