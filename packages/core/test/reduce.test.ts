import { describe, expect, it } from 'vitest'
import { reduce } from '../src/reduce'
import { RESOLVERS } from '../src/model/ids'
import type { Domain, OwnershipState } from '../src/model/domain'
import type { Observation } from '../src/model/observation'
import type { OwnershipStatus } from '../src/model/domain'
import type { RecordStatus } from '../src/model/record'
import { CLAIM_TTL, OWNERSHIP_GRACE, at, days, hours, minutes, plus, seconds } from '../src/time'
import { expectedValue } from '../src/recordSpec'
import {
  T0,
  TOKEN_A,
  TOKEN_C,
  VALUE_A,
  answered,
  domain,
  nxdomain,
  observation,
  ourError,
  pending,
  verified,
  zoneError,
} from '../src/testing/index'

/** A well-formed token — from somebody else's claim. */
const UNKNOWN = expectedValue(TOKEN_C)

/** One observation per record status the table in §2 is keyed on. */
const PRODUCES: Record<Exclude<RecordStatus, 'unchecked'>, Observation> = {
  verified: observation(RESOLVERS.map((r) => answered(r, [VALUE_A]))),
  propagating: observation([answered('cloudflare', [VALUE_A]), nxdomain('google'), nxdomain('adguard')]),
  absent: observation(RESOLVERS.map((r) => nxdomain(r))),
  mismatch: observation(RESOLVERS.map((r) => answered(r, [UNKNOWN]))),
  zone_error: observation(RESOLVERS.map((r) => zoneError(r))),
  check_failed: observation(RESOLVERS.map((r) => ourError(r))),
}

const degraded = (degradedAt = T0): OwnershipState => ({
  status: 'degraded',
  token: TOKEN_A,
  verifiedAt: T0,
  degradedAt,
  revokesAt: plus(degradedAt, OWNERSHIP_GRACE),
  cause: 'record_missing',
})

describe('the record→claim table (state-model §2)', () => {
  const table: Record<OwnershipStatus, Record<Exclude<RecordStatus, 'unchecked'>, OwnershipStatus>> = {
    pending: {
      verified: 'verified',
      propagating: 'pending',
      absent: 'pending',
      mismatch: 'pending',
      zone_error: 'pending',
      check_failed: 'pending',
    },
    verified: {
      verified: 'verified',
      propagating: 'verified',
      absent: 'degraded',
      mismatch: 'degraded',
      zone_error: 'degraded',
      check_failed: 'verified',
    },
    degraded: {
      verified: 'verified',
      propagating: 'degraded',
      absent: 'degraded',
      mismatch: 'degraded',
      zone_error: 'degraded',
      check_failed: 'degraded',
    },
    expired: {
      verified: 'expired',
      propagating: 'expired',
      absent: 'expired',
      mismatch: 'expired',
      zone_error: 'expired',
      check_failed: 'expired',
    },
    revoked: {
      verified: 'revoked',
      propagating: 'revoked',
      absent: 'revoked',
      mismatch: 'revoked',
      zone_error: 'revoked',
      check_failed: 'revoked',
    },
  }

  const claims: Record<OwnershipStatus, OwnershipState> = {
    pending: pending(),
    verified: verified(),
    degraded: degraded(),
    expired: { status: 'expired', claimedAt: T0 },
    revoked: { status: 'revoked', reason: 'grace_expired' },
  }

  // Inside every window: the point is the record→claim mapping, not expiry.
  const now = plus(T0, hours(1))

  for (const [claimStatus, row] of Object.entries(table)) {
    for (const [recordStatus, expected] of Object.entries(row)) {
      it(`${claimStatus} + ${recordStatus} → ${expected}`, () => {
        const state = domain({ ownership: claims[claimStatus as OwnershipStatus] })
        const observationFor = PRODUCES[recordStatus as Exclude<RecordStatus, 'unchecked'>]
        expect(reduce(state, observationFor, now).next.ownership.status).toBe(expected)
      })
    }
  }

  it('degradation carries the cause that produced it', () => {
    const gone = reduce(domain({ ownership: verified() }), PRODUCES.absent, T0).next
    expect(gone.ownership).toMatchObject({ status: 'degraded', cause: 'record_missing' })

    const failing = reduce(domain({ ownership: verified() }), PRODUCES.zone_error, T0).next
    expect(failing.ownership).toMatchObject({ status: 'degraded', cause: 'zone_failing' })

    const wrong = reduce(domain({ ownership: verified() }), PRODUCES.mismatch, T0).next
    expect(wrong.ownership).toMatchObject({ status: 'degraded', cause: 'wrong_token' })
  })

  it('recovery is free', () => {
    const recovered = reduce(domain({ ownership: degraded() }), PRODUCES.verified, T0).next
    expect(recovered.ownership).toEqual({ status: 'verified', token: TOKEN_A, verifiedAt: T0 })
  })

  it('the grace window does not move while degradation continues', () => {
    const start = domain({ ownership: degraded() })
    const later = reduce(start, PRODUCES.mismatch, plus(T0, days(3))).next
    expect(later.ownership).toMatchObject({
      status: 'degraded',
      degradedAt: T0,
      revokesAt: plus(T0, OWNERSHIP_GRACE),
      cause: 'wrong_token',
    })
  })
})

describe('invariant 6 — absence of evidence is never evidence of absence', () => {
  it('A failed lookup concludes nothing', () => {
    const before: Domain = domain({
      ownership: verified(),
      record: { status: 'verified', seenBy: [...RESOLVERS], ttl: { perResolver: [], max: 300 } },
      lastCheckedAt: T0,
      lastChangedAt: T0,
      nextCheckAt: plus(T0, hours(6)),
    })

    const { next, events } = reduce(before, PRODUCES.check_failed, plus(T0, days(1)))

    expect(next.ownership).toEqual(before.ownership)
    expect(next.record).toEqual(before.record)
    expect(next.lastCheckedAt).toBe(before.lastCheckedAt)
    expect(next.lastChangedAt).toBe(before.lastChangedAt)
    // We looked, and we say we looked — but we concluded nothing.
    expect(events.map((e) => e.kind)).toEqual(['check_completed'])
  })

  it('a check_failed sequence of any length leaves every clock untouched', () => {
    let state = domain({ ownership: verified(), lastCheckedAt: T0, lastChangedAt: T0 })
    for (let i = 1; i <= 50; i++) {
      state = reduce(state, PRODUCES.check_failed, plus(T0, minutes(i))).next
    }
    expect(state.lastCheckedAt).toBe(T0)
    expect(state.lastChangedAt).toBe(T0)
    expect(state.ownership.status).toBe('verified')
  })

  it('a degraded claim past its deadline is not revoked on our own failures', () => {
    const state = domain({ ownership: degraded() })
    const past = plus(T0, days(9))

    const stillDegraded = reduce(state, PRODUCES.check_failed, past).next
    expect(stillDegraded.ownership.status).toBe('degraded')

    // The first conclusive observation after the deadline is what revokes it.
    const revoked = reduce(stillDegraded, PRODUCES.absent, past).next
    expect(revoked.ownership).toEqual({ status: 'revoked', reason: 'grace_expired' })
  })
})

describe('windows run on injected time', () => {
  it('The window expires on injected time', () => {
    const started = plus(T0, hours(2))
    const state = domain({ ownership: degraded(started) })
    const deadline = plus(started, OWNERSHIP_GRACE)

    // One second before: still the owner's time to fix it.
    expect(reduce(state, PRODUCES.absent, at(deadline - 1_000)).next.ownership.status).toBe('degraded')

    const { next, events } = reduce(state, PRODUCES.absent, plus(deadline, seconds(1)))
    expect(next.ownership).toEqual({ status: 'revoked', reason: 'grace_expired' })
    expect(events.filter((e) => e.kind === 'state_changed').map((e) => e.level)).toContain('claim')
  })

  it('an unproven claim expires on time alone', () => {
    const state = domain({ ownership: pending() })
    const deadline = plus(T0, CLAIM_TTL)
    expect(reduce(state, PRODUCES.absent, at(deadline - 1)).next.ownership.status).toBe('pending')
    expect(reduce(state, PRODUCES.absent, deadline).next.ownership).toEqual({
      status: 'expired',
      claimedAt: T0,
    })
  })

  it('proof at the moment of expiry still wins', () => {
    const state = domain({ ownership: pending() })
    const deadline = plus(T0, CLAIM_TTL)
    expect(reduce(state, PRODUCES.verified, deadline).next.ownership.status).toBe('verified')
  })
})

describe('the audit log (invariant 5)', () => {
  it('emits check_completed even when nothing changed', () => {
    const steady = domain({
      ownership: verified(),
      record: { status: 'verified', seenBy: [...RESOLVERS], ttl: { perResolver: [], max: 300 } },
    })
    const { events } = reduce(steady, PRODUCES.verified, plus(T0, hours(6)))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'check_completed', to: 'verified' })
  })

  it('emits one event per level that moved, each carrying its evidence', () => {
    const { events } = reduce(domain({ ownership: pending() }), PRODUCES.verified, T0)
    expect(events.map((e) => `${e.kind}:${e.level ?? '-'}`)).toEqual([
      'check_completed:-',
      'state_changed:record',
      'state_changed:claim',
    ])
    for (const event of events) expect(event.evidence).toBe(PRODUCES.verified)
  })

  it('stamps the actor that triggered the check', () => {
    const manual = observation(RESOLVERS.map((r) => answered(r, [VALUE_A])), { actor: 'user' })
    const { events } = reduce(domain({ ownership: pending() }), manual, T0)
    expect(events.every((e) => e.actor === 'user')).toBe(true)
  })
})

describe('the check cadence (state-model §5)', () => {
  it('accelerates while degraded and settles when verified and steady', () => {
    const fresh = reduce(domain({ ownership: pending() }), PRODUCES.verified, T0).next
    expect(fresh.nextCheckAt).toBe(plus(T0, seconds(30)))

    const settled = domain({
      ownership: verified(),
      record: { status: 'verified', seenBy: [...RESOLVERS], ttl: { perResolver: [], max: 300 } },
      lastChangedAt: T0,
    })
    const later = plus(T0, days(2))
    expect(reduce(settled, PRODUCES.verified, later).next.nextCheckAt).toBe(plus(later, hours(6)))

    const broken = reduce(settled, PRODUCES.absent, later).next
    expect(broken.nextCheckAt).toBe(plus(later, minutes(5)))
  })

  it('stops watching a terminal claim', () => {
    const state = domain({ ownership: degraded() })
    const revoked = reduce(state, PRODUCES.absent, plus(T0, days(8))).next
    expect(revoked.ownership.status).toBe('revoked')
    expect(revoked.nextCheckAt).toBeNull()
  })
})
