import type { ResolverId } from './ids'

/** The lifecycle of the DNS record carrying the proof (state-model §3). */
export type RecordState =
  | { readonly status: 'unchecked' }
  | { readonly status: 'absent'; readonly kind: AbsentKind; readonly cname?: string }
  | {
      readonly status: 'propagating'
      readonly direction: Direction
      readonly seenBy: readonly ResolverId[]
      /** Resolvers holding a superseded value of ours. */
      readonly staleAt: readonly ResolverId[]
      readonly ttl: TtlObservation
    }
  | {
      readonly status: 'mismatch'
      readonly observed: readonly ObservedValue[]
      readonly cause: MismatchCause
      /** Same evidence, kinder reading: the offending value is receding while the current token spreads (§3). */
      readonly correcting: CorrectionInProgress | null
    }
  | { readonly status: 'verified'; readonly seenBy: readonly ResolverId[]; readonly ttl: TtlObservation }
  /** Their DNS is failing. */
  | { readonly status: 'zone_error'; readonly errors: readonly ResolverError[] }
  /** Our lookup failed. We conclude nothing (invariant 6). */
  | { readonly status: 'check_failed'; readonly errors: readonly ResolverError[] }

export type RecordStatus = RecordState['status']

/** `nodata` — the name exists but holds no TXT — usually means a CNAME or a typo'd host, and warrants a different hint. */
export type AbsentKind = 'nxdomain' | 'nodata'

export type Direction = 'arriving' | 'receding'

export type CorrectionInProgress = {
  readonly seenBy: readonly ResolverId[]
  /** Resolvers still serving the offending value; it clears within the TTL. */
  readonly clearingAt: readonly ResolverId[]
  readonly ttl: TtlObservation
}

/** Per-resolver, not scalar: each cache counts down independently, so only `max` bounds how long a stale answer persists. */
export type TtlObservation = {
  readonly perResolver: readonly { readonly resolver: ResolverId; readonly ttl: number }[]
  readonly max: number
}

export type ValueKind = 'current' | 'superseded' | 'wildcard_served' | 'unknown'

export type ObservedValue = {
  readonly resolver: ResolverId
  readonly value: string
  readonly kind: ValueKind
}

export type ResolverError =
  | { readonly resolver: ResolverId; readonly side: 'zone'; readonly detail: ZoneErrorDetail }
  | { readonly resolver: ResolverId; readonly side: 'ours'; readonly detail: OurErrorDetail }

export type ZoneErrorDetail = 'servfail' | 'refused' | 'dnssec'
export type OurErrorDetail = 'timeout' | 'network' | 'throttled'

/** state-model §3 — the causes a *mismatch* can carry. */
export type MismatchCause =
  | 'quoted_value'
  | 'appended_apex'
  | 'whitespace'
  | 'truncated'
  | 'wrong_token'
  /** Only a wildcard answers; the record itself is missing. */
  | 'wildcard_shadow'
  | 'unknown_value'

export type DegradedCause = MismatchCause | 'record_missing' | 'zone_failing'

export const ttlOf = (
  perResolver: readonly { readonly resolver: ResolverId; readonly ttl: number }[],
): TtlObservation => ({
  perResolver,
  max: perResolver.reduce((m, r) => Math.max(m, r.ttl), 0),
})
