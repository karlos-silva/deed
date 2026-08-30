import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { reduce } from '../src/reduce'
import { RESOLVERS, type ResolverId } from '../src/model/ids'
import type { Domain, OwnershipState } from '../src/model/domain'
import type { Observation, ResolverAnswer } from '../src/model/observation'
import { OWNERSHIP_GRACE, type Timestamp, at, minutes, plus } from '../src/time'
import { expectedValue } from '../src/recordSpec'
import {
  T0,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
  VALUE_A,
  VALUE_B,
  answered,
  domain,
  nxdomain,
  nodata,
  observation,
  ourError,
  pending,
  verified,
  wildcardProbe,
  zoneError,
} from '../src/testing/index'

/**
 * The invariants of state-model §4, as properties over generated observation
 * sequences rather than as prose (§7).
 */

const WILDCARD = 'v=spf1 -all'
const OTHER_TOKEN = expectedValue(TOKEN_C)

/** Every shape a single resolver's answer can take, as an arbitrary. */
const answerFor = (resolver: ResolverId): fc.Arbitrary<ResolverAnswer> =>
  fc.oneof(
    fc.constant(answered(resolver, [VALUE_A])),
    fc.constant(answered(resolver, [VALUE_B])),
    fc.constant(answered(resolver, [OTHER_TOKEN])),
    fc.constant(answered(resolver, [WILDCARD])),
    fc.constant(answered(resolver, ['"' + VALUE_A + '"'])),
    fc.constant(nxdomain(resolver)),
    fc.constant(nodata(resolver)),
    fc.constant(zoneError(resolver)),
    fc.constant(ourError(resolver)),
  )

const anyObservation: fc.Arbitrary<Observation> = fc
  .tuple(
    fc.tuple(...(RESOLVERS.map(answerFor) as [fc.Arbitrary<ResolverAnswer>, fc.Arbitrary<ResolverAnswer>, fc.Arbitrary<ResolverAnswer>])),
    fc.boolean(),
    fc.constantFrom('user' as const, 'sweep' as const, 'system' as const),
  )
  .map(([answers, wildcardInZone, actor]) =>
    observation(answers, {
      actor,
      ...(wildcardInZone ? { probe: wildcardProbe(WILDCARD) } : {}),
    }),
  )

/** An observation that never carries proof: the current token is unpublished. */
const withoutProof: fc.Arbitrary<Observation> = anyObservation.filter(
  (o) => !o.answers.some((a) => a.outcome === 'answered' && a.values.includes(VALUE_A)),
)

const anyClaim: fc.Arbitrary<OwnershipState> = fc.oneof(
  fc.constant(pending()),
  fc.constant(verified()),
  fc.constant<OwnershipState>({
    status: 'degraded',
    token: TOKEN_A,
    verifiedAt: T0,
    degradedAt: T0,
    revokesAt: plus(T0, OWNERSHIP_GRACE),
    cause: 'record_missing',
  }),
  fc.constant<OwnershipState>({ status: 'expired', claimedAt: T0 }),
  fc.constant<OwnershipState>({ status: 'revoked', reason: 'grace_expired' }),
)

/** Minutes between checks, so a sequence spans real time without real waiting. */
const steps = fc.array(fc.tuple(anyObservation, fc.integer({ min: 1, max: 600 })), {
  minLength: 1,
  maxLength: 12,
})

type Step = { observation: Observation; now: Timestamp }

const walk = (start: Domain, sequence: readonly [Observation, number][]) => {
  let state = start
  let clock = T0
  const trail: { before: Domain; after: Domain; step: Step; events: number[] }[] = []
  for (const [check, gap] of sequence) {
    clock = plus(clock, minutes(gap))
    const { next, events } = reduce(state, check, clock)
    trail.push({
      before: state,
      after: next,
      step: { observation: check, now: clock },
      events: events.map((_, i) => i),
    })
    state = next
  }
  return { state, trail }
}

describe('invariant 9 — state is a pure function of observations', () => {
  it('is deterministic, with no clock of its own', () => {
    fc.assert(
      fc.property(anyClaim, anyObservation, fc.integer({ min: 0, max: 10 ** 9 }), (claim, check, offset) => {
        const state = domain({ ownership: claim })
        const now = plus(T0, minutes(offset))
        expect(reduce(state, check, now)).toEqual(reduce(state, check, now))
      }),
    )
  })

  it('never mutates the state it was given', () => {
    fc.assert(
      fc.property(anyClaim, anyObservation, (claim, check) => {
        const state = domain({ ownership: claim })
        const snapshot = structuredClone(state)
        reduce(state, check, plus(T0, minutes(1)))
        expect(state).toEqual(snapshot)
      }),
    )
  })
})

describe('invariant 6 — absence of evidence is never evidence of absence', () => {
  it('a total our-side failure leaves state and every clock untouched', () => {
    const failed = observation(RESOLVERS.map((r) => ourError(r)))
    fc.assert(
      fc.property(anyClaim, fc.integer({ min: 1, max: 10 ** 6 }), (claim, offset) => {
        const state = domain({ ownership: claim, lastCheckedAt: T0, lastChangedAt: T0 })
        const { next } = reduce(state, failed, plus(T0, minutes(offset)))
        // The one thing time alone may still do is expire an unproven claim.
        if (next.ownership.status !== 'expired') expect(next.ownership).toEqual(state.ownership)
        expect(next.record).toEqual(state.record)
        expect(next.lastCheckedAt).toBe(T0)
      }),
    )
  })
})

describe('invariant 7 — superseded values never reach quorum', () => {
  it('no sequence without the current value ever verifies', () => {
    fc.assert(
      fc.property(fc.array(withoutProof, { minLength: 1, maxLength: 10 }), (sequence) => {
        const start = domain({
          ownership: pending(),
          supersession: { previousToken: TOKEN_B, rotatedAt: T0, honourUntil: at(Number.MAX_SAFE_INTEGER) },
        })
        let state = start
        let clock = T0
        for (const check of sequence) {
          clock = plus(clock, minutes(1))
          state = reduce(state, check, clock).next
          expect(state.ownership.status).not.toBe('verified')
        }
      }),
    )
  })
})

describe('invariant 3 — mismatch never presents waiting as the cure', () => {
  it('a pending claim never acquires a revocation deadline', () => {
    fc.assert(
      fc.property(steps, (sequence) => {
        const { trail } = walk(domain({ ownership: pending() }), sequence)
        for (const { after } of trail) {
          if (after.ownership.status === 'pending') {
            expect(Object.keys(after.ownership)).not.toContain('revokesAt')
          }
        }
      }),
    )
  })
})

describe('invariant 5 — every transition emits exactly one audit event', () => {
  it('one state_changed per level that actually moved, and never otherwise', () => {
    fc.assert(
      fc.property(anyClaim, anyObservation, fc.integer({ min: 1, max: 10 ** 5 }), (claim, check, offset) => {
        const state = domain({ ownership: claim })
        const now = plus(T0, minutes(offset))
        const { next, events } = reduce(state, check, now)

        const changed = events.filter((e) => e.kind === 'state_changed')
        const claimMoved = state.ownership.status !== next.ownership.status
        const recordMoved = state.record.status !== next.record.status

        expect(changed.filter((e) => e.level === 'claim')).toHaveLength(claimMoved ? 1 : 0)
        expect(changed.filter((e) => e.level === 'record')).toHaveLength(recordMoved ? 1 : 0)
        for (const event of changed) expect(event.evidence).toBe(check)
      }),
    )
  })
})

describe('the terminal states are absorbing', () => {
  it('nothing an observation can say brings a revoked or expired claim back', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<OwnershipState>(
          { status: 'expired', claimedAt: T0 },
          { status: 'revoked', reason: 'grace_expired' },
          { status: 'revoked', reason: 'released_by_owner' },
          { status: 'revoked', reason: 'claimed_by_other' },
        ),
        steps,
        (claim, sequence) => {
          const { state } = walk(domain({ ownership: claim }), sequence)
          expect(state.ownership).toEqual(claim)
          expect(state.nextCheckAt).toBeNull()
        },
      ),
    )
  })
})

describe('invariant 4 — recovery is free', () => {
  it('proof after any history returns a claim to verified with no penalty', () => {
    const proof = observation(RESOLVERS.map((r) => answered(r, [VALUE_A])))
    fc.assert(
      fc.property(fc.constantFrom(pending(), verified()), steps, (claim, sequence) => {
        const { state } = walk(domain({ ownership: claim }), sequence)
        // A claim that ran out its own clock is gone; that is not recovery.
        fc.pre(state.ownership.status !== 'revoked' && state.ownership.status !== 'expired')

        const recovered = reduce(state, proof, plus(T0, minutes(10_000))).next.ownership
        expect(recovered.status).toBe('verified')
        expect(Object.keys(recovered).sort()).toEqual(['status', 'token', 'verifiedAt'])
      }),
    )
  })
})
