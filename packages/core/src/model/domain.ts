import type { DomainId, Token, UserId } from './ids'
import type { DegradedCause, RecordState } from './record'
import type { Timestamp } from '../time'

/**
 * A domain has exactly one lifecycle: its ownership claim. Beneath it, the DNS
 * record carrying the proof has a lifecycle of its own (state-model §1).
 */
export type Domain = {
  readonly id: DomainId
  readonly ownerId: UserId
  /** Punycode, lowercased, no trailing dot. */
  readonly name: string
  readonly isSandbox: boolean
  readonly ownership: OwnershipState
  /** Latest view of the proof record (§3). */
  readonly record: RecordState
  /** Set by rotation, honoured until its bound (§3). */
  readonly supersession: Supersession | null
  /** Freshness — first-class and user-visible (D5). */
  readonly lastCheckedAt: Timestamp | null
  /**
   * What the sweep reads; set from the cadence (§5). `null` in the terminal
   * states, where there is nothing left to watch (D14).
   */
  readonly nextCheckAt: Timestamp | null
  /**
   * When this domain last changed at either level. The cadence table in §5 is
   * keyed on "since last state change", and neither `ownership` nor `record`
   * carries a timestamp for the record level (D14).
   */
  readonly lastChangedAt: Timestamp
  readonly createdAt: Timestamp
}

export type Supersession = {
  readonly previousToken: Token
  readonly rotatedAt: Timestamp
  /** `rotatedAt + max(observed TTL at rotation, SUPERSEDE_FLOOR)`. */
  readonly honourUntil: Timestamp
}

export type OwnershipState =
  | {
      readonly status: 'pending'
      readonly token: Token
      readonly claimedAt: Timestamp
      readonly expiresAt: Timestamp
    }
  | { readonly status: 'verified'; readonly token: Token; readonly verifiedAt: Timestamp }
  | {
      readonly status: 'degraded'
      readonly token: Token
      readonly verifiedAt: Timestamp
      readonly degradedAt: Timestamp
      readonly revokesAt: Timestamp
      /**
       * "Your TXT record was deleted" and "your provider now returns a different
       * token" need different copy and different urgency.
       */
      readonly cause: DegradedCause
    }
  | { readonly status: 'expired'; readonly claimedAt: Timestamp }
  | { readonly status: 'revoked'; readonly reason: RevocationReason }

export type OwnershipStatus = OwnershipState['status']

/**
 * `claimed_by_other` is the one revocation that does not return the name to the
 * pool, because the name is now held (state-model §2).
 */
export type RevocationReason = 'grace_expired' | 'released_by_owner' | 'claimed_by_other'

/** The token a claim is currently proving, where the status has one. */
export const activeToken = (o: OwnershipState): Token | null => {
  switch (o.status) {
    case 'pending':
    case 'verified':
    case 'degraded':
      return o.token
    case 'expired':
    case 'revoked':
      return null
  }
}

/** `verified` and `degraded` are exclusive; `pending` is not (invariant 1). */
export const isExclusive = (o: OwnershipState): boolean =>
  o.status === 'verified' || o.status === 'degraded'
