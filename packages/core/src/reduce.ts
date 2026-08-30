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
 * Total, pure, and exhaustive over the union (state-model §6). No `default:`
 * branch anywhere — adding a status must break the build at every site that
 * needs updating.
 *
 * Time-based transitions are evaluated here from `now`, never by a separate
 * scheduler. A state read at time T is correct at time T even if no check has
 * run since; the sweep makes transitions *timely*, never *correct*.
 */
export function reduce(state: Domain, observation: Observation, now: Timestamp): Reduction {
  const record = deriveRecord(observation, expectationOf(state, now), state.record)

  // An observation with no answers is not a completed check. Nothing concluded,
  // nothing logged, no clock advanced.
  if (record.status === 'unchecked') return { next: state, events: [] }

  const ownership = advanceClaim(state, record, now)

  // Invariant 6: if we could not look, we do not conclude — and that includes
  // the clocks and the stored record. A `check_failed` observation is not a
  // record transition, because pretending we looked is the lie it forbids.
  // The claim can still move: `pending → expired` is time-based, and expiring
  // an unproven claim takes nothing away.
  const conclusive = record.status !== 'check_failed'
  const recordChanged = conclusive && state.record.status !== record.status
  const claimChanged = state.ownership.status !== ownership.status

  // "We looked and it held" is the product's freshness claim, so this is
  // emitted even when nothing changed.
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

  // Invariant 5: every transition emits exactly one audit event — one per level
  // that actually moved, each carrying the evidence that produced it.
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

/**
 * The comparison set for this check: the current token, plus anything rotated
 * out and still inside its bound (state-model §3).
 */
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
      // A terminal claim proves nothing, so no observed value can match.
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
      // Expiry is time-based at 14 days. Expiring an unproven claim takes
      // nothing away, so it needs no conclusive evidence.
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
        // Recovery is free: the window resets completely and no penalty is
        // recorded. The user fixed it; that is the outcome we wanted.
        return { status: 'verified', token: claim.token, verifiedAt: now }
      }
      const cause = degradationCause(record)
      // Elapsed time plus a week of our own failed lookups is our outage, not
      // their abandonment (invariant 6), so revocation needs a conclusive
      // observation at or after the deadline that still finds no proof.
      if (cause !== null && now >= claim.revokesAt) {
        return { status: 'revoked', reason: 'grace_expired' }
      }
      // The window does not move. Only the cause is refreshed.
      return cause === null || cause === claim.cause ? claim : { ...claim, cause }
    }

    case 'expired':
    case 'revoked':
      return claim
  }
}

/**
 * Degradation needs conclusive evidence; losing one cache is not loss. A
 * verified claim survives `propagating` in either direction — quorum is the bar
 * for *gaining* verification, not for keeping it.
 */
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
