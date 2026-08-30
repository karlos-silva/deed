import type {
  AuditActor,
  AuditKind,
  Observation,
  OwnershipState,
  RecordState,
  Supersession,
} from '@deed/core'
import type { Database, Json } from './generated'

// JSONB columns hold the core's own unions (state-model §2, §3). Postgres cannot
// prove their shape, so the casts below are assertions, not checked conversions.

export type { Database, Json }

type Raw<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']

export type DomainRow = Omit<Raw<'domains'>, 'ownership' | 'record' | 'supersession'> & {
  ownership: OwnershipState
  record: RecordState
  supersession: Supersession | null
}

export type AuditRow = Omit<Raw<'audit_events'>, 'kind' | 'actor' | 'level' | 'evidence'> & {
  kind: AuditKind
  actor: AuditActor
  level: 'claim' | 'record' | null
  evidence: Observation | null
}

export type LookupKind = 'check_now' | 'preflight' | 'claim'
export type SweepRow = Raw<'sweep_runs'>

/** What `apply_transition` answers (state-model §4, invariant 8). */
export type TransitionResult =
  | { readonly applied: true; readonly version: number; readonly revoked_competing: number }
  | { readonly applied: false; readonly reason: 'stale' | 'missing'; readonly version?: number }

export const toJson = (value: unknown): Json => value as Json

export const asDomainRow = (row: Raw<'domains'>): DomainRow => row as DomainRow
export const asAuditRow = (row: Raw<'audit_events'>): AuditRow => row as AuditRow
export const asTransitionResult = (value: Json): TransitionResult =>
  value as unknown as TransitionResult
