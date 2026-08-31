import { Suspense } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { at, isExclusive, isTerminal } from '@deed/core'
import { type StoredDomain, lastSweep, listDomains } from '@deed/db'
import { session } from '@/lib/session'
import { endedHeadline, humanSince } from '@/lib/copy'
import { ClaimBadge } from '@/components/StatusBadge'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { RowActions } from '@/components/RowActions'
import { Notices } from '@/components/Notices'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Footer } from '@/components/Footer'
import { TopBar } from '@/components/TopBar'
import { claimDomain, releaseDomain, removeFromList, restoreToList } from './actions'

export const dynamic = 'force-dynamic'

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; domain?: string; show?: string }>
}) {
  const current = await session()
  if (current === null) redirect('/')

  const { error, domain: attempted, show } = await searchParams
  const [domains, sweptAt] = await Promise.all([
    listDomains(current.db, current.userId),
    lastSweep(current.db),
  ])
  const clock = at(Date.now())

  const listed = domains.filter((d) => d.hiddenAt === null)
  const removed = domains.filter((d) => d.hiddenAt !== null)
  const showingRemoved = show === 'removed'
  const rows = showingRemoved ? removed : listed

  return (
    <div className="shell">
      <TopBar email={current.email} />
      <Suspense fallback={null}>
        <Notices />
      </Suspense>
      {/* Only while something on this list can still change on its own. */}
      {listed.some((d) => !isTerminal(d.domain.ownership)) && <AutoRefresh seconds={45} />}

      <main className="main">
        <div className="page-head">
          <h1 className="t-title">Domains</h1>
          <AddDomainDialog
            action={claimDomain}
            {...(error !== undefined && { error })}
            {...(attempted !== undefined && { attempted })}
          />
        </div>

        {removed.length > 0 && (
          <nav className="tabs" aria-label="Which claims to show">
            <Link className="tab" href="/domains" aria-current={showingRemoved ? undefined : 'page'}>
              Domains
            </Link>
            <Link
              className="tab"
              href="/domains?show=removed"
              aria-current={showingRemoved ? 'page' : undefined}
            >
              Removed ({removed.length})
            </Link>
          </nav>
        )}

        {domains.length === 0 ? (
          <NothingClaimedYet />
        ) : rows.length === 0 ? (
          <p className="t-body muted">
            {showingRemoved
              ? 'Nothing removed.'
              : 'Every claim is under Removed. Restore one, or add a domain.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="domains">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">{showingRemoved ? 'How it ended' : 'Status'}</th>
                  <th scope="col">{showingRemoved ? 'Removed' : 'Last checked'}</th>
                  <th scope="col" className="created">
                    Created
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.domain.id} row={row} now={clock} removed={showingRemoved} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {domains.length > 0 && (
          <p className="table-foot">
            {listed.length} {listed.length === 1 ? 'domain' : 'domains'}
            {removed.length > 0 && (
              <>
                {' · '}
                <Link href="/domains?show=removed">{removed.length} removed</Link>
              </>
            )}
            {sweptAt !== null && <> · checked in the background {humanSince(sweptAt, clock)}</>}
          </p>
        )}
      </main>

      <Footer />
    </div>
  )
}

function Row({
  row,
  now,
  removed,
}: {
  row: StoredDomain
  now: number
  removed: boolean
}) {
  const { domain, hiddenAt } = row
  const closed = isTerminal(domain.ownership)

  return (
    <tr>
      <th scope="row">
        <Link href={`/domains/${domain.id}`}>
          <span className="row-mark">
            <Image src="/domains-tile.png" alt="" width={740} height={740} />
          </span>
          <span className="name">{domain.name}</span>
          {domain.isSandbox && <span className="badge badge-info">simulated</span>}
        </Link>
      </th>
      <td>
        {removed ? (
          <span className="t-small subtle">{endedHeadline(domain.ownership)}</span>
        ) : (
          <ClaimBadge ownership={domain.ownership} />
        )}
      </td>
      <td className="when">
        {removed
          ? hiddenAt === null
            ? '—'
            : humanSince(hiddenAt, now)
          : domain.lastCheckedAt === null
            ? '—'
            : humanSince(domain.lastCheckedAt, now)}
      </td>
      <td className="when created">{humanSince(domain.createdAt, now)}</td>
      <td className="row-actions">
        {/* Only a closed claim leaves the list; a live one is released first. */}
        <RowActions
          domainId={domain.id}
          name={domain.name}
          state={removed ? 'removed' : closed ? 'closed' : 'live'}
          requireTyping={isExclusive(domain.ownership)}
          release={releaseDomain}
          remove={removeFromList}
          restore={restoreToList}
        />
      </td>
    </tr>
  )
}
