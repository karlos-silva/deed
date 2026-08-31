import { describe, expect, it } from 'vitest'
import {
  RESOLVERS,
  type Domain,
  type OwnershipState,
  type RecordState,
  at,
  domainId,
  plus,
  days,
  token,
  userId,
  isTerminal,
} from '@deed/core'
import { claimGuidance, endedHeadline, recordGuidance } from '../src/lib/copy'

/**
 * Every state the model defines has to produce copy without throwing. The
 * detail page renders one of these on every visit, so a gap here is a blank
 * page for a user whose DNS is fine.
 */
const T0 = at(1_767_225_600_000)
const TOKEN = token('a'.repeat(52))

const domain = (record: RecordState, ownership: OwnershipState): Domain => ({
  id: domainId('d'),
  ownerId: userId('u'),
  name: 'demo.karlos.dev',
  isSandbox: false,
  ownership,
  record,
  supersession: null,
  lastCheckedAt: T0,
  nextCheckAt: plus(T0, days(1)),
  lastChangedAt: T0,
  createdAt: T0,
})

const ttl = { perResolver: [{ resolver: 'cloudflare' as const, ttl: 300 }], max: 300 }

const RECORDS: RecordState[] = [
  { status: 'unchecked' },
  { status: 'absent', kind: 'nxdomain' },
  { status: 'absent', kind: 'nodata' },
  { status: 'absent', kind: 'nodata', cname: 'shop.myshopify.com' },
  { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: [], ttl },
  { status: 'propagating', direction: 'receding', seenBy: ['cloudflare'], staleAt: [], ttl },
  { status: 'propagating', direction: 'arriving', seenBy: [], staleAt: ['google'], ttl },
  { status: 'verified', seenBy: [...RESOLVERS], ttl },
  { status: 'zone_error', errors: [{ resolver: 'cloudflare', side: 'zone', detail: 'servfail' }] },
  { status: 'zone_error', errors: [{ resolver: 'cloudflare', side: 'zone', detail: 'dnssec' }] },
  { status: 'check_failed', errors: [{ resolver: 'google', side: 'ours', detail: 'timeout' }] },
  ...(
    [
      'quoted_value', 'appended_apex', 'whitespace', 'truncated',
      'wrong_token', 'wildcard_shadow', 'unknown_value',
    ] as const
  ).map(
    (cause): RecordState => ({
      status: 'mismatch',
      cause,
      observed: [{ resolver: 'cloudflare', value: 'whatever', kind: 'unknown' }],
      correcting: null,
    }),
  ),
]

const CLAIMS: OwnershipState[] = [
  { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, days(14)) },
  { status: 'verified', token: TOKEN, verifiedAt: T0 },
  {
    status: 'degraded', token: TOKEN, verifiedAt: T0, degradedAt: T0,
    revokesAt: plus(T0, days(7)), cause: 'record_missing',
  },
  { status: 'expired', claimedAt: T0 },
  { status: 'revoked', reason: 'grace_expired' },
  { status: 'revoked', reason: 'released_by_owner' },
  { status: 'revoked', reason: 'claimed_by_other' },
]

describe('the copy layer', () => {
  it('produces guidance for every record state', () => {
    for (const record of RECORDS) {
      const guidance = recordGuidance(domain(record, CLAIMS[0]!))
      expect(guidance.headline, JSON.stringify(record)).toBeTruthy()
      expect(guidance.body, JSON.stringify(record)).toBeTruthy()
    }
  })

  it('names how every closed claim ended, and says nothing about open ones', () => {
    for (const ownership of CLAIMS) {
      const line = endedHeadline(ownership)
      expect(line, ownership.status).toBeTruthy()
      // The Removed list only ever shows terminal claims; the open branch exists
      // to keep the switch exhaustive, not to be read by anyone.
      expect(line === 'Still open', ownership.status).toBe(!isTerminal(ownership))
    }
  })

  it('produces guidance for every ownership state', () => {
    for (const ownership of CLAIMS) {
      const guidance = claimGuidance(ownership)
      if (guidance === null) continue
      expect(guidance.headline, ownership.status).toBeTruthy()
    }
  })

  it('never tells a user to wait through a wrong value', () => {
    for (const record of RECORDS.filter((r) => r.status === 'mismatch')) {
      const guidance = recordGuidance(domain(record, CLAIMS[0]!))
      expect(guidance.waitingHelps, JSON.stringify(record)).toBe(false)
    }
  })
})
