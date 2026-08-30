import type { ResolverId } from '../model/ids'
import type { Observation, ResolverAnswer } from '../model/observation'
import { probedValues } from '../model/observation'
import type {
  AbsentKind,
  CorrectionInProgress,
  Direction,
  ObservedValue,
  RecordState,
  ResolverError,
} from '../model/record'
import { ttlOf } from '../model/record'
import { diagnose } from '../diagnose/cause'
import { expectedValue } from '../recordSpec'
import { QUORUM } from '../time'
import { classifyValue, type Expectation } from './classify'

/**
 * The precedence table of state-model §3, evaluated top to bottom, stopping at
 * the first match. The table is normative; the rule numbers below are its
 * numbering, kept so the code and the spec are read side by side.
 *
 * Rule 1 outranks rules 2–3 deliberately: a wrong value at *one* resolver fails
 * the record even if two others already match. The moment we have evidence that
 * waiting will not help, we stop the clock.
 */
export function deriveRecord(
  observation: Observation,
  expectation: Expectation,
  previous: RecordState,
): RecordState {
  const { answers } = observation

  // 0 — no check has completed.
  if (answers.length === 0) return { status: 'unchecked' }

  const wildcardServed = probedValues(observation.probe)
  const observed: ObservedValue[] = []
  const ttls: { resolver: ResolverId; ttl: number }[] = []
  const errors: ResolverError[] = []
  let sawNodata = false
  let cname: string | undefined

  for (const answer of answers) {
    cname ??= cnameOf(answer)
    switch (answer.outcome) {
      case 'answered': {
        ttls.push({ resolver: answer.resolver, ttl: answer.ttl })
        if (answer.values.length === 0) sawNodata = true
        for (const value of answer.values) {
          observed.push({
            resolver: answer.resolver,
            value,
            kind: classifyValue(value, expectation, wildcardServed),
          })
        }
        break
      }
      case 'nodata':
        sawNodata = true
        break
      case 'nxdomain':
        break
      case 'zone_error':
        errors.push({ resolver: answer.resolver, side: 'zone', detail: answer.detail })
        break
      case 'check_failed':
        errors.push({ resolver: answer.resolver, side: 'ours', detail: answer.detail })
        break
    }
  }

  const ttl = ttlOf(ttls)
  const current = resolversHolding(observed, 'current')
  const superseded = resolversHolding(observed, 'superseded')
  const wildcard = resolversHolding(observed, 'wildcard_served')
  const unknown = observed.filter((o) => o.kind === 'unknown')

  // 1 — any resolver holds an unknown value.
  if (unknown.length > 0) {
    return {
      status: 'mismatch',
      observed,
      cause: diagnose(unknown, expectedOf(expectation), expectation.domain),
      correcting: correctionInProgress(previous, observed, current, ttl),
    }
  }

  // 2 — resolvers holding the current value ≥ QUORUM.
  if (current.length >= QUORUM) return { status: 'verified', seenBy: current, ttl }

  // 3 — resolvers holding the current value ≥ 1.
  if (current.length >= 1) {
    return {
      status: 'propagating',
      direction: directionOf(previous, current.length),
      seenBy: current,
      staleAt: superseded,
      ttl,
    }
  }

  // 4 — some hold a superseded value, none the current one. Rotation in flight:
  //     the fix is arriving, and this is exactly what waiting cures.
  if (superseded.length > 0) {
    return { status: 'propagating', direction: 'arriving', seenBy: [], staleAt: superseded, ttl }
  }

  // 5 — a wildcard is all that answers, so the record itself does not exist.
  if (wildcard.length > 0) {
    return { status: 'mismatch', observed, cause: 'wildcard_shadow', correcting: null }
  }

  // 6/7 — every lookup failed. Their zone failing to answer is a real problem
  //       they must be told about; our own timeout concludes nothing.
  if (errors.length === answers.length) {
    return errors.some((e) => e.side === 'zone')
      ? { status: 'zone_error', errors }
      : { status: 'check_failed', errors }
  }

  // 8 — otherwise.
  const kind: AbsentKind = sawNodata ? 'nodata' : 'nxdomain'
  return cname === undefined ? { status: 'absent', kind } : { status: 'absent', kind, cname }
}

const expectedOf = (expectation: Expectation): string =>
  expectation.current === null ? '' : expectedValue(expectation.current)

const cnameOf = (answer: ResolverAnswer): string | undefined =>
  answer.outcome === 'answered' || answer.outcome === 'nxdomain' || answer.outcome === 'nodata'
    ? answer.cname
    : undefined

const resolversHolding = (
  observed: readonly ObservedValue[],
  kind: ObservedValue['kind'],
): ResolverId[] => [...new Set(observed.filter((o) => o.kind === kind).map((o) => o.resolver))]

/**
 * Direction is not derivable from one observation; it comes from the previous
 * state (state-model §3). Coverage that dropped is receding, coverage that
 * climbed is arriving, and coverage that held keeps whatever it was doing.
 */
function directionOf(previous: RecordState, coverage: number): Direction {
  switch (previous.status) {
    case 'verified':
      return coverage < previous.seenBy.length ? 'receding' : 'arriving'
    case 'propagating':
      if (coverage < previous.seenBy.length) return 'receding'
      if (coverage > previous.seenBy.length) return 'arriving'
      return previous.direction
    case 'unchecked':
    case 'absent':
    case 'mismatch':
    case 'zone_error':
    case 'check_failed':
      return 'arriving'
  }
}

/**
 * "Current value gaining resolvers, one stale wrong value receding" is what a
 * *corrected* mistake looks like from the outside — the mirror image of "user
 * just broke it". The status stays `mismatch` either way, because an unknown
 * value must surface; but when the prior observation shows the same offending
 * value at a shrinking set of resolvers while the current token spreads, the
 * copy hedges (state-model §3).
 */
function correctionInProgress(
  previous: RecordState,
  observed: readonly ObservedValue[],
  current: readonly ResolverId[],
  ttl: CorrectionInProgress['ttl'],
): CorrectionInProgress | null {
  if (previous.status !== 'mismatch') return null

  const before = previous.observed.filter((o) => o.kind === 'unknown')
  const now = observed.filter((o) => o.kind === 'unknown')
  const beforeValues = new Set(before.map((o) => o.value))
  const sameOffence = now.every((o) => beforeValues.has(o.value))
  if (!sameOffence) return null

  const clearingAt = [...new Set(now.map((o) => o.resolver))]
  const offendersBefore = new Set(before.map((o) => o.resolver)).size
  const currentBefore = new Set(
    previous.observed.filter((o) => o.kind === 'current').map((o) => o.resolver),
  ).size

  if (clearingAt.length >= offendersBefore) return null
  if (current.length <= currentBefore) return null
  return { seenBy: current, clearingAt, ttl }
}
