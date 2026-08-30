import type { AuditActor } from './audit'
import type { ResolverId } from './ids'
import type { Timestamp } from '../time'

/** One completed multi-resolver check (state-model §6). */
export type Observation = {
  readonly startedAt: Timestamp
  readonly actor: AuditActor
  /** The challenge host — one entry per resolver. */
  readonly answers: readonly ResolverAnswer[]
  /** The wildcard control probe, same resolvers (§3). */
  readonly probe: readonly ResolverAnswer[]
}

export type ResolverAnswer =
  | {
      readonly resolver: ResolverId
      readonly outcome: 'answered'
      /** One per RR, multi-string TXT already joined. */
      readonly values: readonly string[]
      readonly ttl: number
      readonly cname?: string
    }
  | { readonly resolver: ResolverId; readonly outcome: 'nxdomain' | 'nodata'; readonly cname?: string }
  | {
      readonly resolver: ResolverId
      readonly outcome: 'zone_error'
      readonly detail: 'servfail' | 'refused' | 'dnssec'
    }
  | {
      readonly resolver: ResolverId
      readonly outcome: 'check_failed'
      readonly detail: 'timeout' | 'network' | 'throttled'
    }

export type AnswerOutcome = ResolverAnswer['outcome']

export const probedValues = (probe: readonly ResolverAnswer[]): ReadonlySet<string> => {
  const values = new Set<string>()
  for (const answer of probe) {
    if (answer.outcome === 'answered') for (const value of answer.values) values.add(value)
  }
  return values
}
