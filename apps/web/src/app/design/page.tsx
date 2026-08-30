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
  plus,
  token,
  userId,
} from '@deed/core'
import type { AuditRow } from '@deed/db'
import { claimGuidance, recordGuidance } from '@/lib/copy'
import { AuditLog } from '@/components/AuditLog'
import { ClaimBadge, RecordBadge } from '@/components/StatusBadge'
import { ResolverMatrix } from '@/components/ResolverMatrix'
import { ValueDiff } from '@/components/ValueDiff'
import { TopBar } from '@/components/TopBar'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { claimDomain } from '@/app/domains/actions'
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
const NOISY: AuditRow[] = [
  ...Array.from({ length: 14 }, (_, i) => event(i + 1, {})),
  event(15, { kind: 'state_changed', level: 'claim', from_status: 'pending', to_status: 'verified' }),
  event(16, { kind: 'state_changed', level: 'record', from_status: 'absent', to_status: 'verified' }),
  event(20, { kind: 'claim_created', actor: 'user', to_status: 'pending' }),
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
                <ResolverMatrix domain={d} />
              </div>
            </section>
          )
        })}

        <Section title="The audit log, as reported">
          <AuditLog events={NOISY} now={T0} />
        </Section>

        <Section title="The audit log, empty">
          <AuditLog events={[]} now={T0} />
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="table-foot">5 domains · checked in the background 1 min ago</p>
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
