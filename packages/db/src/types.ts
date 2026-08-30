import type {
  AuditActor,
  AuditKind,
  Observation,
  OwnershipState,
  RecordState,
  Supersession,
} from '@deed/core'
import type { Database, Json } from './generated'

/**
 * The generated rows, with the core's own unions put back where a JSONB column
 * holds one.
 *
 * `ownership`, `record` and `supersession` store exactly what `packages/core`
 * defines (state-model §2, §3). The alternative — flattening a discriminated
 * union across nullable columns — would make the database a second description
 * of the state machine, and the two would drift.
 *
 * Postgres cannot prove the shape of a JSONB column, so these are assertions at
 * one boundary rather than a claim the compiler checked. Keeping them here, in
 * one file, is the point: nothing downstream re-asserts anything.
 */

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

/**
 * Widening for the trip *into* a JSONB column. The core's types are `readonly`
 * and branded; `Json` is neither. Nothing is lost — Postgres stores the same
 * document either way — and doing it once here keeps every call site honest
 * about where the compiler stops helping.
 */
export const toJson = (value: unknown): Json => value as Json

export const asDomainRow = (row: Raw<'domains'>): DomainRow => row as DomainRow
export const asAuditRow = (row: Raw<'audit_events'>): AuditRow => row as AuditRow
export const asTransitionResult = (value: Json): TransitionResult =>
  value as unknown as TransitionResult
