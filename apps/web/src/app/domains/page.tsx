import Link from 'next/link'
import { redirect } from 'next/navigation'
import { at, DOMAINS_PER_ACCOUNT } from '@deed/core'
import { lastSweep, listDomains } from '@deed/db'
import { session } from '@/lib/session'
import { humanSince } from '@/lib/copy'
import { ClaimBadge } from '@/components/StatusBadge'
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
              <div className="field wide">
                <label className="t-label" htmlFor="domain">
                  Domain
                </label>
                <input
                  className="input"
                  id="domain"
                  name="domain"
                  placeholder="acme.com — or acme.test to try it without owning one"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                />
              </div>
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
          <section className="empty" style={{ marginTop: 'var(--space-6)' }}>
            <div className="stack">
              <h2 className="t-section">Nothing claimed yet</h2>
              <p className="t-body muted" style={{ maxWidth: '52ch', margin: '0 auto' }}>
                Claiming generates one high-entropy token scoped to you and this domain. You publish
                it as a single TXT record at{' '}
                <span className="t-mono">_deed-challenge.&lt;your-domain&gt;</span>, and we read
                it back. You will need access to the domain’s DNS — or, if you would rather not use
                a real one, a <span className="t-mono">.test</span> name and nothing else.
              </p>
              <p className="t-small subtle">We only ever make read queries against your DNS.</p>
            </div>
          </section>
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
