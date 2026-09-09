import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  RESOLVERS,
  type Domain,
  type RecordState,
  at,
  domainId,
  days,
  challengeHost,
  expectedValue,
  plus,
  token,
  userId,
} from '@deed/core'
import { ValueDiff } from '../src/components/ValueDiff'
import { ClaimBadge, RecordBadge } from '../src/components/StatusBadge'
import { NothingClaimedYet } from '../src/components/NothingClaimedYet'
import { RecordToPublish, RecordTable, ResolverEvidence } from '../src/components/RecordToPublish'

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
describe('the record table', () => {
  it('is the three columns a panel asks for, and nothing else', () => {
    const props = {
      host: '_deed-challenge.demo',
      suffix: '.karlos.dev',
      value: 'deed-challenge=x',
      hostLabel: 'Host / Name',
      valueLabel: 'Value',
    }
    const html = renderToStaticMarkup(<RecordTable {...props} />)

    expect(html).toContain('Host / Name')
    expect(html).toContain('Value')

    // Type is not a column. It never varies — this product publishes TXT and
    // nothing else — so it is said once, by the card, and the width it held
    // goes to the value.
    expect(html).not.toContain('>Type<')

    // The record's own badge used to sit in a fourth column. It was the third
    // "Verified" on a verified page — the meta row and the verdict banner say
    // it above — and the 88px it held is what pushed the host and the value
    // onto second lines.
    expect(html).not.toContain('Status')

    // The resolver evidence is a table of its own. It briefly shared this one as
    // a second tbody, and the columns do not mean the same things: "Cached for"
    // landed under the value and the resolver names were squeezed to two lines.
    expect(html).not.toContain('Cached for')
    expect(html).not.toContain('Resolver')
  })
})

describe('the detail page renders every state', () => {
  it('draws the badges for each record state, and the matrix when it says something', () => {
    for (const record of RECORDS) {
      const d = domain(record)
      const evidence = renderToStaticMarkup(<ResolverEvidence domain={d} />)
      const badges =
        renderToStaticMarkup(<RecordBadge record={record} />) +
        renderToStaticMarkup(<ClaimBadge ownership={d.ownership} />)
      expect(badges, record.status).not.toContain('undefined')

      // The matrix is a comparison, so it appears when there is something to
      // compare. Nobody asked, nobody has it, and everybody has it are the
      // three states where its three rows would be one sentence repeated —
      // and that sentence is already in the verdict banner above.
      const identical =
        record.status === 'unchecked' ||
        record.status === 'absent' ||
        (record.status === 'verified' && record.seenBy.length === RESOLVERS.length)
      expect(evidence.includes('Cloudflare'), record.status).toBe(!identical)
      expect(evidence === '', record.status).toBe(identical)
    }
  })

  it('says nothing under the record when the resolvers cannot disagree', () => {
    const agreed = renderToStaticMarkup(
      <ResolverEvidence domain={domain({ status: 'verified', seenBy: [...RESOLVERS], ttl })} />,
    )
    expect(agreed).toBe('')

    // Two of three is a disagreement, and which one is missing is the news.
    const partial = renderToStaticMarkup(
      <ResolverEvidence
        domain={domain({ status: 'verified', seenBy: ['cloudflare', 'google'], ttl })}
      />,
    )
    expect(partial).toContain('AdGuard')
    expect(partial).toContain('Cached for')
  })

  it('shows the name it is actually going to query, whatever the suffix', async () => {
    // host + the greyed zone beside it must rejoin into the record's real name.
    // They did not: the host was cut two labels from the right while the zone
    // printed was the whole claim, so `demo.karlos.dev` read back as
    // `_deed-challenge.demo.demo.karlos.dev` — and a `co.uk` claim handed
    // over a host that was wrong to paste, not merely wrong to read.
    for (const name of ['acme.com', 'demo.karlos.dev', 'shop.acme.co.uk', 'a.b.example.com']) {
      const d: Domain = {
        ...domain({ status: 'verified', seenBy: [...RESOLVERS], ttl }),
        name,
        // Verified, so the card asks the zone nothing and this stays a pure render.
        ownership: { status: 'verified', token: TOKEN, verifiedAt: T0 },
      }
      const html = renderToStaticMarkup(
        await RecordToPublish({
          db: null as never,
          domain: d,
          value: expectedValue(TOKEN),
          host: challengeHost(name),
          now: T0,
        }),
      )
      const text = html.replace(/<[^>]+>/g, '')
      expect(text, name).toContain(challengeHost(name))

      // Published and answering: the panel is closed, so the instructions for
      // filling it in are not still on screen.
      expect(text, name).not.toContain('Paste the value')

      // …but which kind of record it is still has to be somewhere.
      expect(text, name).toContain('TXT record')
    }
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