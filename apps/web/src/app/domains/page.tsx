import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { at, isExclusive, isTerminal } from '@deed/core'
import { type StoredDomain, listDomains } from '@deed/db'
import { session } from '@/lib/session'
import { humanSince } from '@/lib/copy'
import { ClaimBadge, claimTone } from '@/components/StatusBadge'
import { DomainMark } from '@/components/DomainMark'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { RowActions } from '@/components/RowActions'
import { Notices } from '@/components/Notices'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Footer } from '@/components/Footer'
import { TopBar } from '@/components/TopBar'
import { claimDomain, releaseDomain, removeFromList } from './actions'

export const dynamic = 'force-dynamic'

export default async function DomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; domain?: string }>
}) {
  const current = await session()
  if (current === null) redirect('/')

  const { error, domain: attempted } = await searchParams
  const domains = await listDomains(current.db, current.userId)
  const clock = at(Date.now())

  // A removed claim is off the list for good; nothing on the page goes looking
  // for it (D21).
  const listed = domains.filter((d) => d.hiddenAt === null)

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

        {listed.length === 0 ? (
          <NothingClaimedYet />
        ) : (
          <div className="table-wrap">
            <table className="domains">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last checked</th>
                  <th scope="col" className="created">
                    Created
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {listed.map((row) => (
                  <Row key={row.domain.id} row={row} now={clock} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {listed.length > 0 && (
          <p className="table-foot">
            {listed.length} {listed.length === 1 ? 'domain' : 'domains'}
          </p>
        )}
      </main>

      <Footer />
    </div>
  )
}

function Row({ row, now }: { row: StoredDomain; now: number }) {
  const { domain } = row
  const closed = isTerminal(domain.ownership)

  return (
    <tr>
      <th scope="row">
        <Link href={`/domains/${domain.id}`}>
          {/* The mark used to be the product's own tile, the same picture on
              every row. It is the row's state now: yellow while a claim is
              pending, green once it is proved, red when it is at risk. */}
          <span className="row-mark" data-state={claimTone(domain.ownership)}>
            <DomainMark />
          </span>
          <span className="name">{domain.name}</span>
          {domain.isSandbox && <span className="badge badge-info">simulated</span>}
        </Link>
      </th>
      <td>
        <ClaimBadge ownership={domain.ownership} />
      </td>
      <td className="when">
        {domain.lastCheckedAt === null ? '—' : humanSince(domain.lastCheckedAt, now)}
      </td>
      <td className="when created">{humanSince(domain.createdAt, now)}</td>
      <td className="row-actions">
        {/* Only a closed claim leaves the list; a live one is released first. */}
        <RowActions
          domainId={domain.id}
          name={domain.name}
          state={closed ? 'closed' : 'live'}
          requireTyping={isExclusive(domain.ownership)}
          release={releaseDomain}
          remove={removeFromList}
        />
      </td>
    </tr>
  )
}
