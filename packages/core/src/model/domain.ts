import type { DomainId, Token, UserId } from './ids'
import type { DegradedCause, RecordState } from './record'
import type { Timestamp } from '../time'

/** One lifecycle for the ownership claim; the DNS record carrying the proof has its own (state-model §1). */
export type Domain = {
  readonly id: DomainId
  readonly ownerId: UserId
  readonly name: string
  readonly isSandbox: boolean
  readonly ownership: OwnershipState
  readonly record: RecordState
  readonly supersession: Supersession | null
  readonly lastCheckedAt: Timestamp | null
  /** What the sweep reads; `null` in the terminal states, where there is nothing left to watch. */
  readonly nextCheckAt: Timestamp | null
  /** Last change at *either* level — the cadence table (§5) keys on it and the record level carries no timestamp. */
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
      readonly cause: DegradedCause
    }
  | { readonly status: 'expired'; readonly claimedAt: Timestamp }
  | { readonly status: 'revoked'; readonly reason: RevocationReason }

export type OwnershipStatus = OwnershipState['status']

/** `claimed_by_other` is the one revocation that does not return the name to the pool (state-model §2). */
export type RevocationReason = 'grace_expired' | 'released_by_owner' | 'claimed_by_other'

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

/**
 * A claim that can never change again: no token to prove, no check to schedule,
 * nothing left to observe. The one state in which a row may leave the list.
 */
export const isTerminal = (o: OwnershipState): boolean =>
  o.status === 'expired' || o.status === 'revoked'

/** `verified` and `degraded` are exclusive; `pending` is not (invariant 1). */
export const isExclusive = (o: OwnershipState): boolean =>
  o.status === 'verified' || o.status === 'degraded'
