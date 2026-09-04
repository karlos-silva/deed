import { notFound } from 'next/navigation'
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
import type { AuditRow, TimelineEntry } from '@deed/db'
import { claimGuidance, endedHeadline, recordGuidance } from '@/lib/copy'
import { verdict } from '@/lib/verdict'
import { DomainMeta } from '@/components/DomainMeta'
import { VerdictBanner } from '@/components/VerdictBanner'
import { AuditLog } from '@/components/AuditLog'
import { ClaimBadge, RecordBadge } from '@/components/StatusBadge'
import { ValueDiff } from '@/components/ValueDiff'
import { TopBar } from '@/components/TopBar'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { RecordTable, ResolverEvidence } from '@/components/RecordToPublish'
import { claimDomain, releaseDomain, removeFromList, restoreToList } from '@/app/domains/actions'
import { ReleaseDialog } from '@/components/ReleaseDialog'
import { RowActions } from '@/components/RowActions'
import Image from 'next/image'

export const dynamic = 'force-dynamic'

// Every state the product can render, on one page, with no sign-in. Development only (S8).
const T0 = at(1_767_225_600_000)
const TOKEN = token('uyxawsmda4slfuoy5kqsxemuu2vfgzuzdmb6e2np2dzscadiqa3q')
const VALUE = expectedValue(TOKEN)
const ttl = {
  perResolver: [
    { resolver: 'cloudflare' as const, ttl: 300 },
    { resolver: 'google' as const, ttl: 14_400 },
  ],
  max: 14_400,
}

const domain = (record: RecordState, ownership?: OwnershipState): Domain => ({
  id: domainId('d'),
  ownerId: userId('u'),
  name: 'demo.karlos.dev',
  isSandbox: false,
  ownership: ownership ?? {
    status: 'pending',
    token: TOKEN,
    claimedAt: T0,
    expiresAt: plus(T0, days(14)),
  },
  record,
  supersession: null,
  lastCheckedAt: T0,
  nextCheckAt: plus(T0, days(1)),
  lastChangedAt: T0,
  createdAt: T0,
})

const RECORDS: [string, RecordState][] = [
  ['unchecked', { status: 'unchecked' }],
  ['absent · nxdomain', { status: 'absent', kind: 'nxdomain' }],
  ['absent · cname at host', { status: 'absent', kind: 'nodata', cname: 'shop.myshopify.com' }],
  [
    'propagating · arriving',
    { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: [], ttl },
  ],
  [
    'propagating · receding',
    { status: 'propagating', direction: 'receding', seenBy: ['cloudflare'], staleAt: [], ttl },
  ],
  [
    'propagating · stale token',
    { status: 'propagating', direction: 'arriving', seenBy: [], staleAt: ['google', 'adguard'], ttl },
  ],
  ['verified', { status: 'verified', seenBy: [...RESOLVERS], ttl }],
  [
    'zone_error · dnssec',
    { status: 'zone_error', errors: [{ resolver: 'cloudflare', side: 'zone', detail: 'dnssec' }] },
  ],
  [
    'check_failed',
    { status: 'check_failed', errors: [{ resolver: 'google', side: 'ours', detail: 'timeout' }] },
  ],
  ...(
    [
      'quoted_value',
      'appended_apex',
      'whitespace',
      'truncated',
      'wrong_token',
      'wildcard_shadow',
      'unknown_value',
    ] as const
  ).map(
    (cause): [string, RecordState] => [
      `mismatch · ${cause}`,
      {
        status: 'mismatch',
        cause,
        observed: [
          { resolver: 'cloudflare', value: `"${VALUE}"`, kind: 'unknown' },
          { resolver: 'google', value: VALUE, kind: 'current' },
        ],
        correcting: null,
      },
    ],
  ),
  [
    'mismatch · correcting',
    {
      status: 'mismatch',
      cause: 'quoted_value',
      observed: [
        { resolver: 'cloudflare', value: `"${VALUE}"`, kind: 'unknown' },
        { resolver: 'google', value: VALUE, kind: 'current' },
        { resolver: 'adguard', value: VALUE, kind: 'current' },
      ],
      correcting: { seenBy: ['google', 'adguard'], clearingAt: ['cloudflare'], ttl },
    },
  ],
]

const CLAIMS: [string, OwnershipState][] = [
  ['pending', { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, days(14)) }],
  ['verified', { status: 'verified', token: TOKEN, verifiedAt: T0 }],
  [
    'degraded',
    {
      status: 'degraded',
      token: TOKEN,
      verifiedAt: T0,
      degradedAt: T0,
      revokesAt: plus(T0, days(7)),
      cause: 'record_missing',
    },
  ],
  ['expired', { status: 'expired', claimedAt: T0 }],
  ['revoked · grace_expired', { status: 'revoked', reason: 'grace_expired' }],
  ['revoked · released_by_owner', { status: 'revoked', reason: 'released_by_owner' }],
  ['revoked · claimed_by_other', { status: 'revoked', reason: 'claimed_by_other' }],
]

const event = (id: number, over: Partial<AuditRow>): AuditRow => ({
  id,
  domain_id: 'd',
  owner_id: 'u',
  domain_name: 'demo.karlos.dev',
  at: new Date(T0 - id * 90_000).toISOString(),
  kind: 'check_completed',
  actor: 'sweep',
  level: null,
  from_status: null,
  to_status: 'verified',
  evidence: null,
  ...over,
})

/** The log exactly as the user photographed it: fourteen identical rows. */
// What `audit_timeline` returns for a claim that was made, verified, and then
// watched: the run is one entry, not fourteen rows, and it is collapsed before
// the page limit so the two moments are still here.
// The shape audit_timeline actually returns, which is the point of the fixture:
// one line per moment, and every routine check inside the run it belongs to.
const NOISY: TimelineEntry[] = [
  {
    kind: 'watch',
    runs: 123,
    newestAt: new Date(T0).toISOString(),
    oldestAt: new Date(T0 - 108_000_000).toISOString(),
    status: 'verified',
    id: 14,
    evidence: null,
  },
  {
    kind: 'moment',
    event: event(15, {
      kind: 'state_changed',
      level: 'claim',
      from_status: 'pending',
      to_status: 'verified',
    }),
  },
  {
    kind: 'watch',
    runs: 9,
    newestAt: new Date(T0 - 115_200_000).toISOString(),
    oldestAt: new Date(T0 - 118_800_000).toISOString(),
    status: 'absent',
    id: 16,
    evidence: null,
  },
  { kind: 'moment', event: event(20, { kind: 'claim_created', actor: 'user', to_status: 'pending' }) },
]

export default function DesignGallery() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="shell">
      <TopBar email="alan.turing@example.com" />

      <main className="main stack-6">
        <div className="stack-2">
          <h1 className="t-title">Every state</h1>
          <p className="t-body muted">
            Development only. Reaching these by hand means owning a domain and breaking it on
            purpose.
          </p>
        </div>

        <Section title="Claim badges">
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {CLAIMS.map(([label, ownership]) => (
              <span key={label} className="row" style={{ gap: 'var(--space-2)' }}>
                <ClaimBadge ownership={ownership} />
                <span className="t-small subtle">{label}</span>
              </span>
            ))}
          </div>
        </Section>

        <Section title="The one verdict, and the facts above it">
          {CLAIMS.map(([label, ownership]) => {
            const d = domain({ status: 'verified', seenBy: [...RESOLVERS], ttl }, ownership)
            return (
              <div key={label} className="stack-3" style={{ marginBottom: 'var(--space-6)' }}>
                <span className="t-small subtle">{label}</span>
                <DomainMeta domain={d} now={T0} closed={isTerminal(ownership)} />
                <VerdictBanner verdict={verdict(d)} />
              </div>
            )
          })}
          <div className="stack-3">
            <span className="t-small subtle">
              verified, on the render that proved it — the one celebratory moment (prd §6.5)
            </span>
            <VerdictBanner
              verdict={verdict(
                domain({ status: 'verified', seenBy: [...RESOLVERS], ttl }, CLAIMS[1]?.[1] ?? {
                  status: 'verified',
                  token: TOKEN,
                  verifiedAt: T0,
                }),
                true,
              )}
            />
          </div>
        </Section>

        <Section title="Claim guidance">
          {CLAIMS.map(([label, ownership]) => {
            const guidance = claimGuidance(ownership)
            if (guidance === null) return null
            return (
              <div key={label} className="callout callout-info" style={{ marginTop: 'var(--space-3)' }}>
                <div className="guidance">
                  <span className="t-small subtle">{label}</span>
                  <strong className="headline">{guidance.headline}</strong>
                  <p className="body">{guidance.body}</p>
                  {guidance.fix !== undefined && <p className="fix">{guidance.fix}</p>}
                </div>
              </div>
            )
          })}
        </Section>

        {RECORDS.map(([label, record]) => {
          const d = domain(record)
          const guidance = recordGuidance(d)
          return (
            <section className="card" key={label}>
              <div className="card-header row-between">
                <h2 className="t-section">{label}</h2>
                <RecordBadge record={record} />
              </div>
              <div className="card-body stack">
                <div className="guidance">
                  <strong className="headline">{guidance.headline}</strong>
                  <p className="body">{guidance.body}</p>
                  {guidance.fix !== undefined && <p className="fix">{guidance.fix}</p>}
                  <p className="verdict-line">
                    {guidance.waitingHelps === null
                      ? 'nothing to wait for'
                      : guidance.waitingHelps
                        ? 'waiting helps'
                        : 'waiting will not fix this'}
                  </p>
                </div>
                {record.status === 'mismatch' && (
                  <ValueDiff expected={VALUE} observed={`"${VALUE}"`} />
                )}
                <ResolverEvidence domain={d} />
              </div>
            </section>
          )
        })}

        <Section title="The audit log, as reported">
          <AuditLog entries={NOISY} now={T0} />
        </Section>

        <Section title="The audit log, empty">
          <AuditLog entries={[]} now={T0} />
        </Section>

        <Section title="The record to publish">
          <RecordTable
            host="_deed-challenge.demo"
            suffix=".karlos.dev"
            value={VALUE}
            hostLabel="Host / Name"
            valueLabel="Value"
            domain={domain({ status: 'verified', seenBy: [...RESOLVERS], ttl }, CLAIMS[1]?.[1])}
          />
          <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
            and the same record for a panel that wants the whole name
          </p>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <RecordTable
              host="_deed-challenge.demo.karlos.dev"
              suffix={null}
              value={VALUE}
              hostLabel="Hostname"
              valueLabel="Enter this value"
            />
          </div>
        </Section>

        <Section title="First run">
          <NothingClaimedYet />
        </Section>

        <Section title="The list, and the Add domain dialog">
          <div className="page-head">
            <h2 className="t-title">Domains</h2>
            <AddDomainDialog action={claimDomain} />
          </div>
          <div className="table-wrap">
            <table className="domains">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last checked</th>
                  <th scope="col" className="created">Created</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {CLAIMS.slice(0, 5).map(([label, ownership], i) => (
                  <tr key={label}>
                    <th scope="row">
                      <a href="#">
                        <span className="row-mark">
                          <Image src="/domains-tile.png" alt="" width={740} height={740} />
                        </span>
                        <span className="name">{['acme.com', 'updates.acme.com', 'shop.acme.co.uk', 'acme.test', 'lapsed.com'][i]}</span>
                        {i === 3 && <span className="badge badge-info">simulated</span>}
                      </a>
                    </th>
                    <td><ClaimBadge ownership={ownership} /></td>
                    <td className="when">{['1 min ago', '4 min ago', '2 h ago', 'just now', '—'][i]}</td>
                    <td className="when created">{['3 mo ago', '2 mo ago', '6 d ago', '1 h ago', '14 d ago'][i]}</td>
                    <td className="row-actions">
                      <RowActions
                        domainId={`live-${i}`}
                        name={['acme.com', 'updates.acme.com', 'shop.acme.co.uk', 'acme.test', 'lapsed.com'][i] ?? 'example.com'}
                        state={i === 4 ? 'closed' : 'live'}
                        requireTyping={i === 1}
                        release={releaseDomain}
                        remove={removeFromList}
                        restore={restoreToList}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-foot">5 domains · 2 removed · checked in the background 1 min ago</p>
        </Section>

        <Section title="Removed, and the release confirmation">
          <nav className="tabs" aria-label="Which claims to show">
            <span className="tab">Domains</span>
            <span className="tab" aria-current="page">
              Removed (2)
            </span>
          </nav>
          <div className="table-wrap">
            <table className="domains">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">How it ended</th>
                  <th scope="col">Removed</th>
                  <th scope="col" className="created">Created</th>
                  <th scope="col"><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {CLAIMS.slice(3, 6).map(([label, ownership], i) => (
                  <tr key={label}>
                    <th scope="row">
                      <a href="#">
                        <span className="row-mark">
                          <Image src="/domains-tile.png" alt="" width={740} height={740} />
                        </span>
                        <span className="name">{['lapsed.com', 'gone.com', 'taken.com'][i]}</span>
                      </a>
                    </th>
                    <td><span className="t-small subtle">{endedHeadline(ownership)}</span></td>
                    <td className="when">{['2 d ago', '3 w ago', '1 mo ago'][i]}</td>
                    <td className="when created">{['4 mo ago', '6 mo ago', '1 y ago'][i]}</td>
                    <td className="row-actions">
                      <RowActions
                        domainId={`removed-${i}`}
                        name={['lapsed.com', 'gone.com', 'taken.com'][i] ?? 'example.com'}
                        state="removed"
                        requireTyping={false}
                        release={releaseDomain}
                        remove={removeFromList}
                        restore={restoreToList}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <ReleaseDialog
              action={releaseDomain}
              domainId="d"
              name="demo.karlos.dev"
              requireTyping
            />
            <span className="t-small subtle">a proved claim — asks for the name back</span>
          </div>
        </Section>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="t-section">{title}</h2>
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}
