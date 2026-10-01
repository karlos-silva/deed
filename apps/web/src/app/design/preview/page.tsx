import { notFound } from 'next/navigation'
import {
  type Domain,
  type OwnershipState,
  type RecordState,
  RESOLVERS,
  activeToken,
  challengeHost,
  days,
  domainId,
  expectedValue,
  isExclusive,
  isTerminal,
  plus,
  providerFromNameservers,
} from '@deed/core'
import { type SandboxZone, addRecord, emptyZone } from '@deed/dns'
import { verdict } from '@/lib/verdict'
import { TopBar } from '@/components/TopBar'
import { Footer } from '@/components/Footer'
import { DeedHeader } from '@/components/DeedHeader'
import { VerdictBanner } from '@/components/VerdictBanner'
import { ValueDiff } from '@/components/ValueDiff'
import { RecordCard } from '@/components/RecordToPublish'
import { SandboxZonePanel } from '@/components/SandboxZonePanel'
import { RowActions } from '@/components/RowActions'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { RegisterTable, Tally } from '@/components/Register'
import { claimDomain, releaseDomain, removeFromList } from '@/app/domains/actions'
import { ENTRIES, T0, TOKEN, VALUE, domain, ttl } from '../fixtures'

export const dynamic = 'force-dynamic'

/**
 * Whole signed-in pages, composed from the same components the real routes use,
 * over made-up claims — so a page can be looked at, and screenshotted, without
 * owning a domain or signing in. Development only.
 *
 *   /design/preview?view=register
 *   /design/preview?view=empty
 *   /design/preview?view=deed&state=pending|verified|mismatch|degraded|released|sandbox
 */
export default async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; state?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { view = 'register', state = 'pending' } = await searchParams

  if (view === 'deed') return <DeedPreview state={state} />
  return <RegisterPreview empty={view === 'empty'} />
}

function RegisterPreview({ empty }: { empty: boolean }) {
  const entries = empty ? [] : ENTRIES
  return (
    <div className="shell">
      <TopBar email="alan.turing@example.com" trail={[{ label: 'Domains' }]} />
      <main className="main register-page enter">
        <header className="register-head">
          <div className="stack-3">
            <p className="eyebrow">The register</p>
            <h1 className="display">Domains</h1>
            {entries.length > 0 && <Tally entries={entries} />}
          </div>
          <AddDomainDialog action={claimDomain} />
        </header>
        {entries.length === 0 ? (
          <NothingClaimedYet />
        ) : (
          <RegisterTable entries={entries} now={T0} release={releaseDomain} remove={removeFromList} />
        )}
        {entries.length > 0 && <p className="table-foot">{entries.length} domains on record</p>}
      </main>
      <Footer />
    </div>
  )
}

const PENDING: OwnershipState = {
  status: 'pending',
  token: TOKEN,
  claimedAt: T0,
  expiresAt: plus(T0, days(14)),
}
const VERIFIED: OwnershipState = { status: 'verified', token: TOKEN, verifiedAt: T0 }

const STATES: Record<string, { record: RecordState; ownership: OwnershipState; name?: string }> = {
  pending: {
    record: { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: [], ttl },
    ownership: PENDING,
  },
  mismatch: {
    record: {
      status: 'mismatch',
      cause: 'quoted_value',
      observed: [
        { resolver: 'cloudflare', value: `"${VALUE}"`, kind: 'unknown' },
        { resolver: 'google', value: VALUE, kind: 'current' },
      ],
      correcting: null,
    },
    ownership: PENDING,
  },
  verified: { record: { status: 'verified', seenBy: [...RESOLVERS], ttl }, ownership: VERIFIED },
  degraded: {
    record: { status: 'absent', kind: 'nxdomain' },
    ownership: {
      status: 'degraded',
      token: TOKEN,
      verifiedAt: T0,
      degradedAt: T0,
      revokesAt: plus(T0, days(7)),
      cause: 'record_missing',
    },
  },
  released: {
    record: { status: 'verified', seenBy: [...RESOLVERS], ttl },
    ownership: { status: 'revoked', reason: 'released_by_owner' },
  },
  sandbox: {
    record: { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: [], ttl },
    ownership: PENDING,
    name: 'acme.test',
  },
}

function DeedPreview({ state }: { state: string }) {
  const chosen = STATES[state] ?? STATES['pending']
  if (chosen === undefined) notFound()

  const d: Domain = {
    ...domain(chosen.record, chosen.ownership),
    id: domainId(`preview-${state}`),
    ...(chosen.name !== undefined && { name: chosen.name, isSandbox: true }),
  }
  const closed = isTerminal(d.ownership)
  const token = activeToken(d.ownership)
  const value = token === null ? null : expectedValue(token)
  const host = challengeHost(d.name)
  const mismatch = d.record.status === 'mismatch' ? d.record : null
  const offending = mismatch?.observed.find((o) => o.kind === 'unknown') ?? null

  const zone: SandboxZone | null = d.isSandbox
    ? addRecord(emptyZone(d.name), { id: 'r1', host: '_deed-challenge', type: 'TXT', value: VALUE, ttl: 300 }, T0)
    : null

  return (
    <div className="shell">
      <TopBar
        email="alan.turing@example.com"
        trail={[{ label: 'Domains', href: '/domains' }, { label: d.name, mono: true }]}
      />
      <main className="main deed enter">
        <DeedHeader
          domain={d}
          now={T0}
          closed={closed}
          unicode={null}
          actions={
            <>
              {!closed && (
                <button className="btn btn-secondary" type="button">
                  Check now
                </button>
              )}
              <RowActions
                domainId={d.id}
                name={d.name}
                state={closed ? 'closed' : 'live'}
                requireTyping={isExclusive(d.ownership)}
                release={releaseDomain}
                remove={removeFromList}
              />
            </>
          }
        />

        <VerdictBanner verdict={verdict(d)} />

        {!closed && (
          <>
            {offending !== null && value !== null && (
              <ValueDiff expected={value} observed={offending.value} />
            )}
            {value !== null && (
              <RecordCard
                domain={d}
                value={value}
                host={host}
                zoneInfo={
                  d.ownership.status === 'pending' && !d.isSandbox
                    ? {
                        name: d.name,
                        registered: true,
                        nameservers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'],
                        provider: providerFromNameservers(['ada.ns.cloudflare.com']),
                        wildcard: null,
                        cnameAtHost: null,
                        zoneFailing: false,
                        warnings: [],
                      }
                    : null
                }
              />
            )}
            {zone !== null && <SandboxZonePanel domain={d} zone={zone} expected={value} />}
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
