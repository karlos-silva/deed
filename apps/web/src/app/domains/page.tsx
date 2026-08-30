import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { at } from '@deed/core'
import { lastSweep, listDomains } from '@deed/db'
import { session } from '@/lib/session'
import { humanSince } from '@/lib/copy'
import { ClaimBadge } from '@/components/StatusBadge'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
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
          <h1 className="t-title">Domains</h1>
          <AddDomainDialog action={claimDomain} {...(error !== undefined && { error })} />
        </div>

        {domains.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {domains.map(({ domain }) => (
                  <tr key={domain.id}>
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
                      <ClaimBadge ownership={domain.ownership} />
                    </td>
                    <td className="when">
                      {domain.lastCheckedAt === null
                        ? '—'
                        : humanSince(domain.lastCheckedAt, clock)}
                    </td>
                    <td className="when created">{humanSince(domain.createdAt, clock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {domains.length > 0 && (
          <p className="table-foot">
            {domains.length} {domains.length === 1 ? 'domain' : 'domains'}
            {sweptAt !== null && <> · checked in the background {humanSince(sweptAt, clock)}</>}
          </p>
        )}
      </main>

      <Footer />
    </div>
  )
}
