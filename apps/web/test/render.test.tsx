import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  RESOLVERS,
  type Domain,
  type RecordState,
  at,
  domainId,
  days,
  expectedValue,
  plus,
  token,
  userId,
} from '@deed/core'
import type { AuditRow } from '@deed/db'
import { AuditLog } from '../src/components/AuditLog'
import { ResolverMatrix } from '../src/components/ResolverMatrix'
import { ValueDiff } from '../src/components/ValueDiff'
import { ClaimBadge, RecordBadge } from '../src/components/StatusBadge'

/**
 * The detail page renders these on every visit, so anything that throws here is
 * a blank page for a user whose DNS is fine. Driven by the shapes the database
 * actually returns.
 */
const T0 = at(1_767_225_600_000)
const TOKEN = token('a'.repeat(52))
const ttl = { perResolver: [{ resolver: 'cloudflare' as const, ttl: 300 }], max: 300 }

const domain = (record: RecordState): Domain => ({
  id: domainId('d'),
  ownerId: userId('u'),
  name: 'demo.karlos.dev',
  isSandbox: false,
  ownership: { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, days(14)) },
  record,
  supersession: null,
  lastCheckedAt: T0,
  nextCheckAt: plus(T0, days(1)),
  lastChangedAt: T0,
  createdAt: T0,
})

const RECORDS: RecordState[] = [
  { status: 'unchecked' },
  { status: 'absent', kind: 'nxdomain' },
  { status: 'absent', kind: 'nodata', cname: 'shop.myshopify.com' },
  { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: ['google'], ttl },
  { status: 'propagating', direction: 'receding', seenBy: ['cloudflare'], staleAt: [], ttl },
  { status: 'verified', seenBy: [...RESOLVERS], ttl },
  { status: 'zone_error', errors: [{ resolver: 'cloudflare', side: 'zone', detail: 'dnssec' }] },
  { status: 'check_failed', errors: [{ resolver: 'google', side: 'ours', detail: 'timeout' }] },
  {
    status: 'mismatch',
    cause: 'quoted_value',
    observed: [
      { resolver: 'cloudflare', value: `"${expectedValue(TOKEN)}"`, kind: 'unknown' },
      { resolver: 'google', value: expectedValue(TOKEN), kind: 'current' },
    ],
    correcting: null,
  },
]

/** The exact shape PostgREST returns, timestamps included. */
const events: AuditRow[] = [
  {
    id: 9, domain_id: 'd', owner_id: 'u', domain_name: 'demo.karlos.dev',
    at: '2026-08-30T04:30:46.97+00:00', kind: 'claim_created', actor: 'user',
    level: null, from_status: null, to_status: 'pending', evidence: null,
  },
  {
    id: 3, domain_id: 'd', owner_id: 'u', domain_name: 'demo.karlos.dev',
    at: '2026-08-30T04:31:00.6+00:00', kind: 'state_changed', actor: 'sweep',
    level: 'record', from_status: 'unchecked', to_status: 'absent', evidence: null,
  },
  {
    id: 2, domain_id: 'd', owner_id: 'u', domain_name: 'demo.karlos.dev',
    at: '2026-08-30T04:31:00.6+00:00', kind: 'check_completed', actor: 'sweep',
    level: null, from_status: null, to_status: 'absent', evidence: null,
  },
]

describe('the detail page renders every state', () => {
  it('draws the resolver matrix and both badges for each record state', () => {
    for (const record of RECORDS) {
      const d = domain(record)
      const html =
        renderToStaticMarkup(<ResolverMatrix domain={d} />) +
        renderToStaticMarkup(<RecordBadge record={record} />) +
        renderToStaticMarkup(<ClaimBadge ownership={d.ownership} />)
      expect(html, record.status).toContain('Cloudflare')
    }
  })

  it('draws the audit log from the rows the database returns', () => {
    const html = renderToStaticMarkup(<AuditLog events={events} now={Date.parse(events[0]!.at)} />)
    expect(html).toContain('Claim created')
    expect(html).toContain('not looked yet')
    expect(html).not.toContain('Invalid Date')
  })

  it('draws an empty log without pretending something happened', () => {
    const html = renderToStaticMarkup(<AuditLog events={[]} now={T0} />)
    expect(html).toContain('Nothing has happened yet')
  })

  it('marks exactly the two quote characters in the diff', () => {
    const expected = expectedValue(TOKEN)
    const html = renderToStaticMarkup(<ValueDiff expected={expected} observed={`"${expected}"`} />)
    expect(html.match(/<mark>/g) ?? []).toHaveLength(2)
  })
})
