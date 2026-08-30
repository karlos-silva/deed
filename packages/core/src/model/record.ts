import type { ResolverId } from './ids'

/**
 * The lifecycle of the DNS record carrying the proof (state-model §3).
 *
 * Kept as its own vocabulary rather than folded into the claim, because any
 * future capability's records run through it unchanged — one renderer, one set
 * of tests.
 */
export type RecordState =
  | { readonly status: 'unchecked' }
  | { readonly status: 'absent'; readonly kind: AbsentKind; readonly cname?: string }
  | {
      readonly status: 'propagating'
      readonly direction: Direction
      /** Resolvers holding the current value. */
      readonly seenBy: readonly ResolverId[]
      /** Resolvers holding a superseded value of ours. */
      readonly staleAt: readonly ResolverId[]
      readonly ttl: TtlObservation
    }
  | {
      readonly status: 'mismatch'
      readonly observed: readonly ObservedValue[]
      readonly cause: MismatchCause
      /**
       * Set when the same evidence has a kinder reading: the offending value is
       * receding while the current token spreads (state-model §3). The status is
       * unchanged — an unknown value must surface — but the copy hedges.
       */
      readonly correcting: CorrectionInProgress | null
    }
  | { readonly status: 'verified'; readonly seenBy: readonly ResolverId[]; readonly ttl: TtlObservation }
  /** Their DNS is failing. */
  | { readonly status: 'zone_error'; readonly errors: readonly ResolverError[] }
  /** Our lookup failed. We conclude nothing (invariant 6). */
  | { readonly status: 'check_failed'; readonly errors: readonly ResolverError[] }

export type RecordStatus = RecordState['status']

/**
 * `nxdomain` — the name does not exist, which is normal before the record is
 * added. `nodata` — the name exists but holds no TXT, which usually means a
 * CNAME or a typo'd host, and warrants a different hint.
 */
export type AbsentKind = 'nxdomain' | 'nodata'

/**
 * "Seen by 2 of 3" means *almost there* when arriving and *this is
 * disappearing* when receding. Identical evidence, opposite copy.
 */
export type Direction = 'arriving' | 'receding'

export type CorrectionInProgress = {
  /** Resolvers already holding the current value. */
  readonly seenBy: readonly ResolverId[]
  /** Resolvers still serving the offending value; it clears within the TTL. */
  readonly clearingAt: readonly ResolverId[]
  readonly ttl: TtlObservation
}

/**
 * TTL is a set, not a scalar: every resolver counts down independently in its
 * own cache. The authoritative maximum is the only one that predicts how long a
 * stale answer can persist.
 */
export type TtlObservation = {
  readonly perResolver: readonly { readonly resolver: ResolverId; readonly ttl: number }[]
  readonly max: number
}

/** How an observed value was classified before any precedence rule ran (§3). */
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
  /** Provider wrapped the value in quotes. */
  | 'quoted_value'
  /** Provider appended the zone name. */
  | 'appended_apex'
  /** An invisible character survived the paste. */
  | 'whitespace'
  /** The panel cut the value short. */
  | 'truncated'
  /** A well-formed token from a different claim. */
  | 'wrong_token'
  /** Only a wildcard answers; the record itself is missing. */
  | 'wildcard_shadow'
  /** Present, wrong, and no known quirk explains it. */
  | 'unknown_value'

export type DegradedCause = MismatchCause | 'record_missing' | 'zone_failing'

export const ttlOf = (
  perResolver: readonly { readonly resolver: ResolverId; readonly ttl: number }[],
): TtlObservation => ({
  perResolver,
  max: perResolver.reduce((m, r) => Math.max(m, r.ttl), 0),
})
