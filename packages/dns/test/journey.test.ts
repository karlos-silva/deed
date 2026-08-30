import { describe, expect, it } from 'vitest'
import {
  CHALLENGE_LABEL,
  OWNERSHIP_GRACE,
  SUPERSEDE_FLOOR,
  type AuditActor,
  type AuditEvent,
  type Domain,
  type MismatchCause,
  type Timestamp,
  type Token,
  domainId,
  expectedValue,
  hours,
  minutes,
  plus,
  reduce,
  seconds,
  token,
  userId,
} from '@deed/core'
import { T0 } from '@deed/core/testing'
import { createSandboxPort } from '../src/sandbox/adapter'
import {
  type SandboxZone,
  type ZoneOutage,
  type ZoneRecordType,
  addRecord,
  deleteRecord,
  emptyZone,
  setOutage,
} from '../src/sandbox/zone'
import { observe } from '../src/observe'

/**
 * The product, driven end to end through the simulated zone.
 *
 * This is what D2 buys: every state and every diagnosis is reachable by editing
 * a zone, with no real domain, no fixtures, and no hand-forced state. The same
 * port, the same reducer and the same audit log a real domain uses.
 */

const NAME = 'acme.test'
const PROBE = 'q7x2m9velbn4tk1sjh0d'
const TOKEN = token('a'.repeat(52))
const VALUE = expectedValue(TOKEN)
/** Long enough for every resolver to have adopted a change (max delay 95s). */
const SETTLE = seconds(120)

class Simulation {
  zone: SandboxZone = emptyZone(NAME)
  clock: Timestamp = T0
  events: AuditEvent[] = []
  domain: Domain

  constructor(overrides: Partial<Domain> = {}) {
    this.domain = {
      id: domainId('sim'),
      ownerId: userId('owner'),
      name: NAME,
      isSandbox: true,
      ownership: { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, hours(336)) },
      record: { status: 'unchecked' },
      supersession: null,
      lastCheckedAt: null,
      nextCheckAt: T0,
      lastChangedAt: T0,
      createdAt: T0,
      ...overrides,
    }
  }

  publish(value: string, host = CHALLENGE_LABEL, type: ZoneRecordType = 'TXT'): string {
    const id = `r${this.zone.records.length + 1}`
    this.zone = addRecord(this.zone, { id, host, value, type }, this.clock)
    return id
  }

  remove(id: string): void {
    this.zone = deleteRecord(this.zone, id, this.clock)
  }

  fail(outage: ZoneOutage): void {
    this.zone = setOutage(this.zone, outage)
  }

  advance(by: number): this {
    this.clock = plus(this.clock, by as never)
    return this
  }

  rotate(next: Token, observedTtl = 300): void {
    const claim = this.domain.ownership
    if (claim.status !== 'pending' && claim.status !== 'verified' && claim.status !== 'degraded') {
      throw new Error('nothing to rotate')
    }
    this.domain = {
      ...this.domain,
      ownership: { ...claim, token: next },
      supersession: {
        previousToken: claim.token,
        rotatedAt: this.clock,
        honourUntil: plus(this.clock, Math.max(seconds(observedTtl), SUPERSEDE_FLOOR) as never),
      },
    }
  }

  async check(actor: AuditActor = 'sweep'): Promise<Domain> {
    const observation = await observe(createSandboxPort(this.zone), NAME, {
      now: this.clock,
      actor,
      probeLabel: PROBE,
    })
    const { next, events } = reduce(this.domain, observation, this.clock)
    this.domain = next
    this.events.push(...events)
    return next
  }

  /** Settle every cache, then check — what the sweep would eventually see. */
  async settle(): Promise<Domain> {
    return this.advance(SETTLE).check()
  }
}

/* ------------------------------------------------------------------ S3 --- */

describe('claim and prove', () => {
  it('Before the first check', () => {
    // Rendering `absent` before the first lookup tells the user their record is
    // missing when we have not looked (state-model §3).
    const sim = new Simulation()
    expect(sim.domain.record.status).toBe('unchecked')
    expect(sim.domain.lastCheckedAt).toBeNull()
  })

  it('Proof at quorum', async () => {
    const sim = new Simulation()
    sim.publish(VALUE)

    // Cloudflare at 25s, Google at 55s — quorum is two of three.
    await sim.advance(seconds(60)).check()
    expect(sim.domain.record.status).toBe('verified')
    expect(sim.domain.ownership.status).toBe('verified')
  })

  it('A sandbox domain is provable without owning anything', async () => {
    const sim = new Simulation()
    expect(sim.domain.isSandbox).toBe(true)

    await sim.settle()
    expect(sim.domain.record.status).toBe('absent')

    sim.publish(VALUE)
    await sim.settle()

    expect(sim.domain.ownership.status).toBe('verified')
    // The same engine: nothing in the reducer knows this zone was simulated.
    expect(sim.events.some((e) => e.kind === 'state_changed' && e.to === 'verified')).toBe(true)
  })
})

/* ------------------------------------------------------------------ S4 --- */

describe('understanding the wait', () => {
  it('Partial arrival names its evidence', async () => {
    const sim = new Simulation()
    sim.publish(VALUE)
    await sim.advance(seconds(40)).check()

    expect(sim.domain.record).toMatchObject({
      status: 'propagating',
      direction: 'arriving',
      seenBy: ['cloudflare'],
    })
    if (sim.domain.record.status !== 'propagating') return
    // Which resolver has it, and what TTL it reported.
    expect(sim.domain.record.ttl.perResolver).toEqual([{ resolver: 'cloudflare', ttl: 300 }])
  })

  it('A verified record starting to vanish reads differently', async () => {
    const sim = new Simulation()
    const record = sim.publish(VALUE)
    await sim.settle()
    expect(sim.domain.record.status).toBe('verified')

    sim.remove(record)
    // Cloudflare drops it at +25s; the others still serve it.
    await sim.advance(seconds(30)).check()

    expect(sim.domain.record.status).toBe('verified') // quorum is 2 of 3
    await sim.advance(seconds(30)).check()
    expect(sim.domain.record).toMatchObject({ status: 'propagating', direction: 'receding' })
    // Identical evidence to "arriving", opposite copy — and the claim holds.
    expect(sim.domain.ownership.status).toBe('verified')
  })

  it('Verification survives the tab closing', async () => {
    // Nothing here is driven by a page; the sweep is the only actor.
    const sim = new Simulation()
    sim.publish(VALUE)
    const before = sim.domain.lastCheckedAt

    await sim.advance(minutes(10)).check('sweep')

    expect(before).toBeNull()
    expect(sim.domain.lastCheckedAt).toBe(sim.clock)
    expect(sim.events.every((e) => e.actor === 'sweep')).toBe(true)
  })
})

/* ------------------------------------------------------------------ S5 --- */

const causeOf = (domain: Domain): MismatchCause | null =>
  domain.record.status === 'mismatch' ? domain.record.cause : null

describe('understanding failure', () => {
  it('The provider added quotes', async () => {
    const sim = new Simulation()
    sim.publish(`"${VALUE}"`)
    await sim.settle()
    expect(causeOf(sim.domain)).toBe('quoted_value')
  })

  it('The provider appended the zone', async () => {
    const sim = new Simulation()
    sim.publish(`${VALUE}.${NAME}`)
    await sim.settle()
    expect(causeOf(sim.domain)).toBe('appended_apex')
  })

  it('Waiting will not help, and we say so', async () => {
    const sim = new Simulation()
    sim.publish(`"${VALUE}"`)
    await sim.settle()

    // A wrong value is not a delay: the record never enters a propagation
    // window, and the claim never starts a countdown (invariant 3).
    expect(sim.domain.record.status).toBe('mismatch')
    expect(sim.domain.ownership.status).toBe('pending')
    expect(JSON.stringify(sim.domain.ownership)).not.toContain('revokesAt')
  })

  it('A corrected mistake stops reading as fatal', async () => {
    const sim = new Simulation()
    const wrong = sim.publish(`"${VALUE}"`)
    await sim.settle()
    expect(causeOf(sim.domain)).toBe('quoted_value')

    // The user fixes it: the wrong value is deleted and the right one added.
    sim.remove(wrong)
    sim.publish(VALUE)
    await sim.advance(seconds(30)).check()

    // Still a mismatch — an unknown value must surface — but the copy hedges,
    // because the prior observation shows it receding while the token spreads.
    expect(sim.domain.record.status).toBe('mismatch')
    if (sim.domain.record.status !== 'mismatch') return
    expect(sim.domain.record.correcting).not.toBeNull()
    expect(sim.domain.record.correcting?.seenBy).toEqual(['cloudflare'])

    await sim.settle()
    expect(sim.domain.record.status).toBe('verified')
  })

  it('Their problem versus ours', async () => {
    const theirs = new Simulation()
    theirs.publish(VALUE)
    await theirs.settle()
    theirs.fail('servfail')
    await theirs.advance(seconds(1)).check()
    expect(theirs.domain.record.status).toBe('zone_error')
    // Their zone failing is a real problem they must be told about.
    expect(theirs.domain.ownership).toMatchObject({ status: 'degraded', cause: 'zone_failing' })

    const ours = new Simulation()
    ours.publish(VALUE)
    await ours.settle()
    const settled = ours.domain
    ours.fail('timeout')
    await ours.advance(hours(3)).check()
    // Our failure concludes nothing: not the record, not the freshness, not the
    // claim (invariant 6).
    expect(ours.domain.record).toEqual(settled.record)
    expect(ours.domain.lastCheckedAt).toBe(settled.lastCheckedAt)
    expect(ours.domain.ownership.status).toBe('verified')
  })

  it('Every failure in the taxonomy can be staged by hand', async () => {
    // Each row of prd §7, produced by a zone edit and nothing else — no test
    // fixture, no real domain, no forced state.
    const staged: [string, () => Promise<Domain>][] = [
      ['not_found', () => new Simulation().settle()],
      [
        'partially_propagated',
        async () => {
          const sim = new Simulation()
          sim.publish(VALUE)
          return sim.advance(seconds(40)).check()
        },
      ],
      ['quoted_value', () => stage(`"${VALUE}"`)],
      ['appended_apex', () => stage(`${VALUE}.${NAME}`)],
      ['whitespace', () => stage(` ${VALUE}`)],
      ['truncated', () => stage(VALUE.slice(0, -14))],
      ['wrong_token', () => stage(expectedValue(token('z'.repeat(52))))],
      ['wildcard_shadow', () => stage('v=spf1 -all', '*')],
      [
        'cname_at_host',
        async () => {
          const sim = new Simulation()
          sim.publish('shop.myshopify.com', CHALLENGE_LABEL, 'CNAME')
          return sim.settle()
        },
      ],
      [
        'servfail',
        async () => {
          const sim = new Simulation()
          sim.fail('servfail')
          return sim.settle()
        },
      ],
      [
        'dnssec',
        async () => {
          const sim = new Simulation()
          sim.fail('dnssec')
          return sim.settle()
        },
      ],
    ]

    const reached = new Map<string, string>()
    for (const [row, run] of staged) {
      const domain = await run()
      reached.set(row, describeOutcome(domain))
    }

    expect(Object.fromEntries(reached)).toEqual({
      not_found: 'absent:nxdomain',
      partially_propagated: 'propagating:arriving',
      quoted_value: 'mismatch:quoted_value',
      appended_apex: 'mismatch:appended_apex',
      whitespace: 'mismatch:whitespace',
      truncated: 'mismatch:truncated',
      wrong_token: 'mismatch:wrong_token',
      wildcard_shadow: 'mismatch:wildcard_shadow',
      cname_at_host: 'absent:nodata',
      servfail: 'zone_error:servfail',
      dnssec: 'zone_error:dnssec',
    })

    // `stale_token` is the twelfth row and lives at `propagating` via
    // supersession, which the rotation scenarios below cover on their own.
  })
})

const stage = async (value: string, host = CHALLENGE_LABEL): Promise<Domain> => {
  const sim = new Simulation()
  sim.publish(value, host)
  return sim.settle()
}

function describeOutcome(domain: Domain): string {
  const record = domain.record
  switch (record.status) {
    case 'absent':
      return `absent:${record.kind}`
    case 'propagating':
      return `propagating:${record.direction}`
    case 'mismatch':
      return `mismatch:${record.cause}`
    case 'zone_error':
      return `zone_error:${record.errors[0]?.detail ?? '?'}`
    case 'check_failed':
      return `check_failed:${record.errors[0]?.detail ?? '?'}`
    case 'verified':
    case 'unchecked':
      return record.status
  }
}

/* ------------------------------------------------------------------ S6 --- */

describe('continuity', () => {
  it('A verified record is deleted', async () => {
    const sim = new Simulation()
    const record = sim.publish(VALUE)
    await sim.settle()
    expect(sim.domain.ownership.status).toBe('verified')

    sim.remove(record)
    await sim.settle()

    expect(sim.domain.record.status).toBe('absent')
    expect(sim.domain.ownership).toMatchObject({
      status: 'degraded',
      cause: 'record_missing',
      revokesAt: plus(sim.clock, OWNERSHIP_GRACE),
    })

    // The transition is in the log, with the evidence that produced it.
    const transition = sim.events.find((e) => e.kind === 'state_changed' && e.to === 'degraded')
    expect(transition?.evidence).toBeDefined()
    expect(transition?.evidence?.answers).toHaveLength(3)
  })

  it('An outage on our side revokes nothing', async () => {
    const sim = new Simulation()
    const record = sim.publish(VALUE)
    await sim.settle()
    sim.remove(record)
    await sim.settle()
    expect(sim.domain.ownership.status).toBe('degraded')

    // A week of our own failed lookups is our outage, not their abandonment.
    sim.fail('timeout')
    for (let i = 0; i < 12; i++) await sim.advance(hours(16)).check()
    expect(sim.domain.ownership.status).toBe('degraded')

    // The first conclusive check after the deadline is what revokes it.
    sim.fail(null)
    await sim.advance(seconds(1)).check()
    expect(sim.domain.ownership).toEqual({ status: 'revoked', reason: 'grace_expired' })
  })

  it('The window expires', async () => {
    const sim = new Simulation()
    const record = sim.publish(VALUE)
    await sim.settle()
    sim.remove(record)
    await sim.settle()

    const deadline = sim.domain.ownership.status === 'degraded' ? sim.domain.ownership.revokesAt : T0
    sim.clock = plus(deadline, seconds(-1))
    await sim.check()
    expect(sim.domain.ownership.status).toBe('degraded')

    sim.clock = plus(deadline, seconds(1))
    await sim.check()
    expect(sim.domain.ownership).toEqual({ status: 'revoked', reason: 'grace_expired' })
  })
})

/* ------------------------------------------------------------------ S7 --- */

describe('recovery', () => {
  const NEXT = token('b'.repeat(52))

  it('Rotation does not read as breakage', async () => {
    const sim = new Simulation()
    sim.publish(VALUE)
    await sim.settle()
    expect(sim.domain.ownership.status).toBe('verified')

    // The token is rotated; the zone still holds only the previous value.
    sim.rotate(NEXT)
    await sim.advance(seconds(1)).check()

    expect(sim.domain.record).toMatchObject({ status: 'propagating', direction: 'arriving' })
    if (sim.domain.record.status !== 'propagating') return
    expect(sim.domain.record.staleAt).toHaveLength(3)
    // And the claim is untouched: rotation is recovery, not breakage.
    expect(sim.domain.ownership.status).toBe('verified')
  })

  it('The old token cannot prove anything', async () => {
    const sim = new Simulation({
      ownership: { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, hours(336)) },
    })
    sim.publish(VALUE)
    await sim.settle()
    expect(sim.domain.ownership.status).toBe('verified')

    // A fresh claim on the same name, holding only the superseded value.
    const rotated = new Simulation()
    rotated.publish(VALUE)
    rotated.rotate(NEXT)
    await rotated.settle()

    expect(rotated.domain.record.status).toBe('propagating')
    expect(rotated.domain.ownership.status).not.toBe('verified')
  })

  it('Supersession expires', async () => {
    const sim = new Simulation()
    sim.publish(VALUE)
    await sim.settle()

    sim.rotate(NEXT)
    await sim.advance(seconds(1)).check()
    expect(sim.domain.record.status).toBe('propagating')

    // max(observed TTL, 24h) after rotation, the previous value is just wrong.
    await sim.advance(hours(25)).check()
    expect(sim.domain.record).toMatchObject({ status: 'mismatch', cause: 'wrong_token' })
    // …and a verified claim degrades from there, with the usual window to fix it.
    expect(sim.domain.ownership).toMatchObject({ status: 'degraded', cause: 'wrong_token' })
  })

  it('publishing the new token completes the rotation', async () => {
    const sim = new Simulation()
    const old = sim.publish(VALUE)
    await sim.settle()

    sim.rotate(NEXT)
    sim.publish(expectedValue(NEXT))
    sim.remove(old)
    await sim.settle()

    expect(sim.domain.record.status).toBe('verified')
    expect(sim.domain.ownership.status).toBe('verified')
  })
})
