import { describe, expect, it } from 'vitest'
import {
  RESOLVERS,
  type Domain,
  type OwnershipState,
  type RecordState,
  at,
  days,
  domainId,
  expectedValue,
  isTerminal,
  plus,
  token,
  userId,
} from '@deed/core'
import { verdict } from '../src/lib/verdict'

/**
 * The page used to print `claimGuidance` and `recordGuidance` side by side, so a
 * released domain said "You released this domain" and, forty pixels below,
 * "Ownership proven — we keep checking". One function now answers for both, and
 * these are the properties that keep it honest.
 */

const T0 = at(1_767_225_600_000)
const TOKEN = token('a'.repeat(52))
const ttl = { perResolver: [{ resolver: 'cloudflare' as const, ttl: 300 }], max: 300 }

const RECORDS: RecordState[] = [
  { status: 'unchecked' },
  { status: 'absent', kind: 'nxdomain' },
  { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: [], ttl },
  { status: 'verified', seenBy: [...RESOLVERS], ttl },
  { status: 'zone_error', errors: [{ resolver: 'cloudflare', side: 'zone', detail: 'servfail' }] },
  { status: 'check_failed', errors: [{ resolver: 'google', side: 'ours', detail: 'timeout' }] },
  {
    status: 'mismatch',
    cause: 'wrong_token',
    observed: [{ resolver: 'cloudflare', value: expectedValue(TOKEN), kind: 'unknown' }],
    correcting: null,
  },
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

const every = (): Domain[] =>
  CLAIMS.flatMap((ownership) => RECORDS.map((record) => domain(record, ownership)))

describe('the one verdict', () => {
  it('says something in every combination of claim and record', () => {
    for (const d of every()) {
      const said = verdict(d)
      const where = `${d.ownership.status}/${d.record.status}`
      expect(said.headline, where).toBeTruthy()
      expect(said.body, where).toBeTruthy()
    }
  })

  it('never tells a closed claim that its proof is present', () => {
    // The bug this replaced: a released domain whose `record` still said
    // `verified`, because releasing never touches the record.
    for (const d of every().filter((x) => isTerminal(x.ownership))) {
      const said = verdict(d)
      expect(said.headline, d.ownership.status).not.toMatch(/proven/i)
      expect(said.tone, d.ownership.status).not.toBe('success')
      expect(said.celebrate).toBe(false)
    }
  })

  it('never tells a degraded claim that a missing record is normal', () => {
    // `recordGuidance(absent)` says the record is not there yet and that this is
    // expected before you add it. To somebody about to lose a name they proved,
    // that is the worst sentence on the site.
    for (const d of every().filter((x) => x.ownership.status === 'degraded')) {
      const said = verdict(d)
      expect(said.tone).toBe('danger')
      expect(said.headline).toBe('Ownership is at risk')
      expect(said.waitingHelps).toBe(false)
    }
  })

  it('celebrates only the claim that has just become verified', () => {
    for (const d of every()) {
      const said = verdict(d, true)
      const shouldBloom = d.ownership.status === 'verified'
      expect(said.celebrate, `${d.ownership.status}/${d.record.status}`).toBe(shouldBloom)
    }
  })

  it('does not celebrate a claim that was already verified', () => {
    // prd §6.5 asks for one moment, and AutoRefresh re-renders every 20–45s.
    for (const d of every().filter((x) => x.ownership.status === 'verified')) {
      expect(verdict(d).celebrate).toBe(false)
    }
  })

  it('answers whether waiting helps, or says nothing at all', () => {
    for (const d of every()) {
      const said = verdict(d)
      expect([true, false, null], `${d.ownership.status}/${d.record.status}`).toContain(
        said.waitingHelps,
      )
    }
  })
})
