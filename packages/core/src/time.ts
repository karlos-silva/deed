/**
 * Time, as data. `now` is always a parameter (state-model §4, invariant 9) —
 * that is what makes a seven-day window testable in microseconds.
 */

/** Milliseconds since the Unix epoch. */
export type Timestamp = number & { readonly __brand: 'Timestamp' }

/** A duration in milliseconds. */
export type Duration = number & { readonly __brand: 'Duration' }

export const at = (ms: number): Timestamp => ms as Timestamp
export const seconds = (n: number): Duration => (n * 1_000) as Duration
export const minutes = (n: number): Duration => seconds(n * 60)
export const hours = (n: number): Duration => minutes(n * 60)
export const days = (n: number): Duration => hours(n * 24)
export const perHour = (n: number): number => n

export const plus = (t: Timestamp, d: Duration): Timestamp => at(t + d)
export const minus = (t: Timestamp, d: Duration): Timestamp => at(t - d)
export const longest = (a: Duration, b: Duration): Duration => (a > b ? a : b)
export const since = (from: Timestamp, to: Timestamp): Duration => (to - from) as Duration

/** state-model §5. */
export const QUORUM = 2
export const RESOLVER_COUNT = 3
export const CLAIM_TTL = days(14)
export const OWNERSHIP_GRACE = days(7)
export const SUPERSEDE_FLOOR = hours(24)
export const CHECK_NOW_COOLDOWN = seconds(30)
export const USER_LOOKUP_BUDGET = perHour(60)
export const CLAIM_ATTEMPTS = perHour(20)
export const DOMAINS_PER_ACCOUNT = 25
