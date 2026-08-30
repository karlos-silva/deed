import Link from 'next/link'
import { redirect } from 'next/navigation'
import { at, DOMAINS_PER_ACCOUNT } from '@deed/core'
import { lastSweep, listDomains } from '@deed/db'
import { session } from '@/lib/session'
import { humanSince } from '@/lib/copy'
import { ClaimBadge } from '@/components/StatusBadge'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { ClaimField } from '@/components/ClaimField'
import { Footer } from '@/components/Footer'
import { TopBar } from '@/components/TopBar'
import { claimDomain } from './actions'

export const dynamic = 'force-dynamic'

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const current = await session()
  if (current === null) redirect('/')

  const { error } = await searchParams
  const [domains, sweptAt] = await Promise.all([
    listDomains(current.db, current.userId),
    lastSweep(current.db),
  ])
  const clock = at(Date.now())

  return (
    <div className="shell">
      <TopBar email={current.email} />

      <main className="main">
        <div className="page-head">
          <div className="stack-2">
            <h1 className="t-title">Domains</h1>
            <p className="t-body muted">
              Publish one TXT record and we will read it back from three independent resolvers —
              and keep reading it, so this stays a fact rather than a badge.
            </p>
          </div>
          {sweptAt !== null && (
            <span className="t-small subtle nowrap">
              background sweep · {humanSince(sweptAt, clock)}
            </span>
          )}
        </div>

        <section className="card">
          <div className="card-body stack">
            <form action={claimDomain} className="zone-form">
              <ClaimField />
              <button className="btn btn-primary" type="submit">
                Claim
              </button>
            </form>

            {error !== undefined && (
              <div className="callout callout-danger" role="alert">
                {error}
              </div>
            )}

            <p className="t-small subtle">
              Anything ending in <span className="t-mono">.test</span> runs against a simulated zone
              you edit yourself — no domain required, and every failure state is reachable on
              demand. {domains.length} of {DOMAINS_PER_ACCOUNT} domains used.
            </p>
          </div>
        </section>

        {domains.length === 0 ? (
          <NothingClaimedYet />
        ) : (
          <div className="domain-list" style={{ marginTop: 'var(--space-6)' }}>
            {domains.map(({ domain }) => (
              <Link className="domain-row" key={domain.id} href={`/domains/${domain.id}`}>
                <span className="grow stack-2">
                  <span className="name">{domain.name}</span>
                  {domain.isSandbox && <span className="t-small subtle">simulated zone</span>}
                </span>
                <span className="freshness">
                  {domain.lastCheckedAt === null
                    ? 'not checked yet'
                    : `checked ${humanSince(domain.lastCheckedAt, clock)}`}
                </span>
                <ClaimBadge ownership={domain.ownership} />
              </Link>
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}
