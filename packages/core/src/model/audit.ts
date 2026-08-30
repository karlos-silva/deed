import type { DomainId } from './ids'
import type { Observation } from './observation'
import type { Timestamp } from '../time'

/**
 * The log is the product surface for "show your work". A transition that leaves
 * no trace is a bug (invariant 5).
 *
 * `state_changed` always carries the evidence that produced it; events are
 * append-only and immutable; `check_completed` is emitted even when nothing
 * changed, because "we looked and it held" is the product's freshness claim.
 */
export type AuditEvent = {
  readonly domainId: DomainId
  readonly at: Timestamp
  readonly kind: AuditKind
  readonly actor: AuditActor
  /** Which lifecycle moved, on `state_changed` (D14). */
  readonly level?: 'claim' | 'record'
  /** Prior claim or record status, on `state_changed`. */
  readonly from?: string
  readonly to?: string
  /** The completed check behind a verdict. */
  readonly evidence?: Observation
}

export type AuditKind =
  | 'claim_created'
  | 'check_completed'
  | 'state_changed'
  | 'token_rotated'
  | 'released'
  | 'reclaimed'

export type AuditActor = 'user' | 'sweep' | 'system'
