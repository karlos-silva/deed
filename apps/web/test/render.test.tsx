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
import type { AuditRow, TimelineEntry } from '@deed/db'
import { AuditLog } from '../src/components/AuditLog'
import { ResolverMatrix } from '../src/components/ResolverMatrix'
import { ValueDiff } from '../src/components/ValueDiff'
import { ClaimBadge, RecordBadge } from '../src/components/StatusBadge'
import { NothingClaimedYet } from '../src/components/NothingClaimedYet'
import { RecordTable } from '../src/components/RecordToPublish'

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

  it('draws the audit log from the entries the database returns', () => {
    // `audit_timeline` hands back entries, not rows: a run of identical checks
    // is already one watch by the time it reaches the component.
    const entries: TimelineEntry[] = [
      ...events.map((event) => ({ kind: 'moment' as const, event })),
      {
        kind: 'watch' as const,
        runs: 12,
        newestAt: events[0]!.at,
        oldestAt: events[0]!.at,
        status: 'verified',
        id: 99,
        // The run's last check, which is the only part of a run worth opening.
        evidence: {
          startedAt: T0,
          actor: 'sweep',
          answers: [
            {
              resolver: 'cloudflare' as const,
              outcome: 'answered' as const,
              values: ['deed-challenge=x'],
              ttl: 300,
            },
          ],
          probe: [],
        },
      },
    ]
    const html = renderToStaticMarkup(<AuditLog entries={entries} now={Date.parse(events[0]!.at)} />)
    expect(html).toContain('You claimed this domain')
    expect(html).toContain('not looked at yet')
    expect(html).not.toContain('Invalid Date')

    // The actor enum never reaches the page.
    expect(html).not.toMatch(/SWEEP|>sweep<|>system</)

    // A transition carries a tone; a run of checks is marked quiet so it reads
    // as freshness rather than as something having happened.
    expect(html).toMatch(/data-state="(ok|problem|neutral|progress|closed)"/)
    expect(html).toContain('data-state="quiet"')

    // One entry is one row: the evidence opens from the line itself rather than
    // from a disclosure that costs a row under every entry.
    expect(html).not.toContain('What each resolver answered')
    expect(html).toContain('<summary>')

    // A run of identical checks names the status that held. "Nothing changed"
    // alone made the reader supply the subject, and the one they supplied was
    // that the interesting events had been hidden.
    expect(html).toContain('Checked 12 times — still verified')
    expect(html).not.toContain('nothing changed')
  })

  it('draws an empty log without pretending something happened', () => {
    const html = renderToStaticMarkup(<AuditLog entries={[]} now={T0} />)
    expect(html).toContain('Nothing has happened yet')
  })

  it('A first-time account has somewhere to start', () => {
    const html = renderToStaticMarkup(<NothingClaimedYet />)

    // It says what claiming does and names the way in that needs nothing you do
    // not already have…
    expect(html).toMatch(/token/i)
    expect(html).toMatch(/TXT record/i)
    expect(html).toMatch(/\.test/)

    // …and it is not an empty table under a heading.
    expect(html).not.toContain('<table')
    expect(html).not.toContain('<tbody')

    // Two lines, not a lecture. The screen this replaces had three paragraphs.
    expect(html.replace(/<[^>]+>/g, ' ').trim().length).toBeLessThan(200)
  })

  it('marks exactly the two quote characters in the diff', () => {
    const expected = expectedValue(TOKEN)
    const html = renderToStaticMarkup(<ValueDiff expected={expected} observed={`"${expected}"`} />)
    expect(html.match(/<mark>/g) ?? []).toHaveLength(2)
  })

  it('gives the panel the name it wants, and shows the one it appends', () => {
    // The relative form is what Copy hands over; the zone is text beside it.
    // Showing the absolute name is the failure class every product that does it
    // ships a warning paragraph about.
    const relative = renderToStaticMarkup(
      <RecordTable
        host="_deed-challenge.demo"
        suffix=".karlos.dev"
        value="deed-challenge=abc"
        hostLabel="Host"
        valueLabel="Value"
      />,
    )
    expect(relative).toContain('_deed-challenge.demo')
    expect(relative).toContain('zone-suffix')
    expect(relative).toContain('.karlos.dev')

    // A panel that wants the whole name gets the whole name, and no dimmed tail
    // suggesting something is added for it.
    const absolute = renderToStaticMarkup(
      <RecordTable
        host="_deed-challenge.demo.karlos.dev"
        suffix={null}
        value="deed-challenge=abc"
        hostLabel="Hostname"
        valueLabel="Enter this value"
      />,
    )
    expect(absolute).toContain('_deed-challenge.demo.karlos.dev')
    expect(absolute).not.toContain('zone-suffix')

    // The header follows the panel's own vocabulary, which is why the column
    // names are a prop rather than a constant.
    expect(absolute).toContain('Hostname')
    expect(absolute).toContain('Enter this value')
  })

  it('never truncates the value it asks you to publish', () => {
    const html = renderToStaticMarkup(
      <RecordTable
        host="_deed-challenge"
        suffix=".example.com"
        value={`deed-challenge=${'a'.repeat(52)}`}
        hostLabel="Host"
        valueLabel="Value"
      />,
    )
    expect(html).toContain('a'.repeat(52))
  })
})