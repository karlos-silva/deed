import type { Domain } from './model/domain'
import {
  type Duration,
  type Timestamp,
  hours,
  minutes,
  plus,
  seconds,
  since,
} from './time'

/** Backoff, not a fixed interval (state-model §5) — a fixed one burns rate limit on shared DoH endpoints. */
export function checkInterval(domain: Domain, now: Timestamp): Duration | null {
  switch (domain.ownership.status) {
    // Degraded *accelerates*: this is the window where the user is actively fixing something.
    case 'degraded':
      return minutes(5)
    case 'expired':
    case 'revoked':
      // Terminal. The sweep never picks these up again.
      return null
    case 'pending':
    case 'verified': {
      const settled = since(domain.lastChangedAt, now)
      if (settled < minutes(5)) return seconds(30)
      if (settled < hours(1)) return minutes(2)
      if (settled < hours(24)) return minutes(15)
      return domain.ownership.status === 'verified' ? hours(6) : minutes(15)
    }
  }
}

export const nextCheckFrom = (domain: Domain, now: Timestamp): Timestamp | null => {
  const interval = checkInterval(domain, now)
  return interval === null ? null : plus(now, interval)
}
