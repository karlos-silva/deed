import type { DomainId } from './ids'
import type { Observation } from './observation'
import type { Timestamp } from '../time'

/** Append-only. A transition that leaves no trace is a bug (invariant 5). */
export type AuditEvent = {
  readonly domainId: DomainId
  readonly at: Timestamp
  readonly kind: AuditKind
  readonly actor: AuditActor
  /** Which lifecycle moved, on `state_changed` (D14). */
  readonly level?: 'claim' | 'record'
  readonly from?: string
  readonly to?: string
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
