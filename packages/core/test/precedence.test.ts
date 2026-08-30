import { describe, expect, it } from 'vitest'
import { deriveRecord } from '../src/derive/record'
import type { Expectation } from '../src/derive/classify'
import { reduce } from '../src/reduce'
import { RESOLVERS, type ResolverId } from '../src/model/ids'
import type { RecordState, RecordStatus } from '../src/model/record'
import { SUPERSEDE_FLOOR, plus } from '../src/time'
import {
  T0,
  TOKEN_A,
  TOKEN_B,
  VALUE_A,
  VALUE_B,
  answered,
  domain,
  nxdomain,
  observation,
  ourError,
  pending,
  verified,
  wildcardProbe,
  zoneError,
} from '../src/testing/index'

const WILDCARD = 'v=spf1 -all'
const UNKNOWN = 'deed-challenge=not-the-one'
const UNCHECKED: RecordState = { status: 'unchecked' }

const expectation: Expectation = { domain: 'example.com', current: TOKEN_A, superseded: [] }
const rotated: Expectation = { domain: 'example.com', current: TOKEN_A, superseded: [TOKEN_B] }

describe('the precedence table (state-model §3)', () => {
  it('A wrong value outranks a correct majority', () => {
    // A wrong value at *one* resolver fails the record even if two others match.
    const check = observation([
      answered('cloudflare', [VALUE_A]),
      answered('google', [VALUE_A]),
      answered('adguard', [UNKNOWN]),
    ])

    const record = deriveRecord(check, expectation, UNCHECKED)
    expect(record.status).toBe('mismatch')

    // ...and no grace window is started or extended.
    const { next } = reduce(domain({ ownership: pending() }), check, T0)
    expect(next.ownership.status).toBe('pending')
    expect(JSON.stringify(next.ownership)).not.toContain('revokesAt')
  })

  it('A superseded value never reaches quorum', () => {
    const check = observation([
      answered('cloudflare', [VALUE_B]),
      answered('google', [VALUE_B]),
      nxdomain('adguard'),
    ])

    const record = deriveRecord(check, rotated, UNCHECKED)
    expect(record).toMatchObject({
      status: 'propagating',
      direction: 'arriving',
      seenBy: [],
      staleAt: ['cloudflare', 'google'],
    })

    const claim = domain({
      ownership: pending(),
      supersession: {
        previousToken: TOKEN_B,
        rotatedAt: T0,
        honourUntil: plus(T0, SUPERSEDE_FLOOR),
      },
    })
    expect(reduce(claim, check, T0).next.ownership.status).toBe('pending')
  })

  it('proof at quorum outranks everything below it', () => {
    const record = deriveRecord(
      observation([
        answered('cloudflare', [VALUE_A]),
        answered('google', [VALUE_A]),
        ourError('adguard'),
      ]),
      expectation,
      UNCHECKED,
    )
    expect(record).toMatchObject({ status: 'verified', seenBy: ['cloudflare', 'google'] })
  })

  it('a wildcard that serves the token itself still proves control of the zone', () => {
    // Putting the token there required zone control, which is the thing being proven.
    const record = deriveRecord(
      observation(
        [answered('cloudflare', [VALUE_A]), answered('google', [VALUE_A]), answered('adguard', [VALUE_A])],
        { probe: wildcardProbe(VALUE_A) },
      ),
      expectation,
      UNCHECKED,
    )
    expect(record.status).toBe('verified')
  })

  it('every lookup failing on our side concludes nothing about the zone', () => {
    const record = deriveRecord(
      observation([ourError('cloudflare'), ourError('google', 'throttled'), ourError('adguard', 'network')]),
      expectation,
      UNCHECKED,
    )
    expect(record.status).toBe('check_failed')
  })

  it('a zone-side failure among total failure is reported as their zone failing', () => {
    // Mixed total failure resolves to zone_error: a SERVFAIL is positive
    // evidence about their zone, and swallowing it sends nobody to fix it.
    const record = deriveRecord(
      observation([zoneError('cloudflare'), ourError('google'), ourError('adguard')]),
      expectation,
      UNCHECKED,
    )
    expect(record.status).toBe('zone_error')
  })

  it('an absent record distinguishes nxdomain from nodata', () => {
    const gone = deriveRecord(
      observation([nxdomain('cloudflare'), nxdomain('google'), nxdomain('adguard')]),
      expectation,
      UNCHECKED,
    )
    expect(gone).toMatchObject({ status: 'absent', kind: 'nxdomain' })

    const empty = deriveRecord(
      observation([
        { resolver: 'cloudflare', outcome: 'nodata', cname: 'shop.example.net' },
        nxdomain('google'),
        nxdomain('adguard'),
      ]),
      expectation,
      UNCHECKED,
    )
    expect(empty).toMatchObject({ status: 'absent', kind: 'nodata', cname: 'shop.example.net' })
  })
})

/**
 * The seven ways a single resolver can answer, per the S1 scenario. The probe
 * either answers (a wildcard is in the zone) or is silent.
 */
const KINDS = [
  'current',
  'superseded',
  'wildcard',
  'unknown',
  'absent',
  'zone_error',
  'our_error',
] as const
type Kind = (typeof KINDS)[number]

const answerFor = (resolver: ResolverId, kind: Kind) => {
  switch (kind) {
    case 'current':
      return answered(resolver, [VALUE_A])
    case 'superseded':
      return answered(resolver, [VALUE_B])
    case 'wildcard':
      return answered(resolver, [WILDCARD])
    case 'unknown':
      return answered(resolver, [UNKNOWN])
    case 'absent':
      return nxdomain(resolver)
    case 'zone_error':
      return zoneError(resolver)
    case 'our_error':
      return ourError(resolver)
  }
}

/**
 * The table in state-model §3, transcribed. Deliberately written as the rules
 * read rather than as the implementation is factored, so a change to one has to
 * be argued against the other.
 */
function tableSays(kinds: readonly Kind[]): RecordStatus {
  const count = (k: Kind) => kinds.filter((x) => x === k).length
  if (kinds.length === 0) return 'unchecked' // rule 0
  if (count('unknown') > 0) return 'mismatch' // rule 1
  if (count('current') >= 2) return 'verified' // rule 2
  if (count('current') >= 1) return 'propagating' // rule 3
  if (count('superseded') > 0) return 'propagating' // rule 4
  if (count('wildcard') > 0) return 'mismatch' // rule 5
  if (count('zone_error') + count('our_error') === kinds.length) {
    return count('zone_error') > 0 ? 'zone_error' : 'check_failed' // rules 6, 7
  }
  return 'absent' // rule 8
}

describe('the precedence table, enumerated', () => {
  it('The precedence table is enumerated exhaustively, not sampled', () => {
    const cases: { kinds: Kind[]; probeAnswers: boolean; status: RecordStatus }[] = []

    for (const a of KINDS) {
      for (const b of KINDS) {
        for (const c of KINDS) {
          for (const probeAnswers of [true, false]) {
            const kinds = [a, b, c]
            // A wildcard-served value with a silent probe is incoherent: the
            // probe is what makes a value wildcard-served in the first place.
            if (!probeAnswers && kinds.includes('wildcard')) continue

            const record = deriveRecord(
              observation(
                kinds.map((kind, index) => answerFor(RESOLVERS[index]!, kind)),
                probeAnswers ? { probe: wildcardProbe(WILDCARD) } : {},
              ),
              rotated,
              UNCHECKED,
            )
            cases.push({ kinds, probeAnswers, status: record.status })
          }
        }
      }
    }

    expect(cases).toHaveLength(559)

    for (const { kinds, probeAnswers, status } of cases) {
      const expected = tableSays(probeAnswers ? kinds : kinds.map(withoutWildcards))
      expect(status, `${kinds.join('/')} probe=${probeAnswers}`).toBe(expected)
    }

    // Every status the table can produce is actually reached by the enumeration,
    // so a rule that became unreachable would show up as a gap here.
    expect(new Set(cases.map((c) => c.status))).toEqual(
      new Set(['mismatch', 'verified', 'propagating', 'zone_error', 'check_failed', 'absent']),
    )
  })
})

/** With no probe, a wildcard-served value is just an unknown value. */
const withoutWildcards = (kind: Kind): Kind => (kind === 'wildcard' ? 'unknown' : kind)

describe('direction comes from the previous state', () => {
  it('climbs from absent as arriving', () => {
    const previous: RecordState = { status: 'absent', kind: 'nxdomain' }
    const record = deriveRecord(
      observation([answered('cloudflare', [VALUE_A]), nxdomain('google'), nxdomain('adguard')]),
      expectation,
      previous,
    )
    expect(record).toMatchObject({ status: 'propagating', direction: 'arriving' })
  })

  it('drops from verified as receding', () => {
    const previous = deriveRecord(
      observation(RESOLVERS.map((r) => answered(r, [VALUE_A]))),
      expectation,
      UNCHECKED,
    )
    const record = deriveRecord(
      observation([answered('cloudflare', [VALUE_A]), nxdomain('google'), nxdomain('adguard')]),
      expectation,
      previous,
    )
    expect(record).toMatchObject({ status: 'propagating', direction: 'receding' })
  })

  it('keeps its direction while coverage holds', () => {
    const first = deriveRecord(
      observation(RESOLVERS.map((r) => answered(r, [VALUE_A]))),
      expectation,
      UNCHECKED,
    )
    const receding = deriveRecord(
      observation([answered('cloudflare', [VALUE_A]), nxdomain('google'), nxdomain('adguard')]),
      expectation,
      first,
    )
    const still = deriveRecord(
      observation([answered('cloudflare', [VALUE_A]), nxdomain('google'), nxdomain('adguard')]),
      expectation,
      receding,
    )
    expect(still).toMatchObject({ status: 'propagating', direction: 'receding' })
  })
})

describe('a verified claim survives what a pending one cannot gain from', () => {
  it('keeps verification through a receding record', () => {
    const claim = domain({
      ownership: verified(),
      record: { status: 'verified', seenBy: [...RESOLVERS], ttl: { perResolver: [], max: 300 } },
    })
    const { next } = reduce(
      claim,
      observation([answered('cloudflare', [VALUE_A]), nxdomain('google'), nxdomain('adguard')]),
      T0,
    )
    expect(next.record.status).toBe('propagating')
    expect(next.ownership.status).toBe('verified')
  })
})
