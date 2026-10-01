import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { at, isTerminal } from '@deed/core'
import { listDomains } from '@deed/db'
import { session } from '@/lib/session'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { type RegisterEntry, RegisterTable, Tally } from '@/components/Register'
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
  const entries: RegisterEntry[] = domains
    .filter((d) => d.hiddenAt === null)
    .map(({ domain }) => ({
      id: domain.id,
      name: domain.name,
      ownership: domain.ownership,
      isSandbox: domain.isSandbox,
      lastCheckedAt: domain.lastCheckedAt,
      createdAt: domain.createdAt,
    }))

  return (
    <div className="shell">
      <TopBar email={current.email} trail={[{ label: 'Domains' }]} />
      <Suspense fallback={null}>
        <Notices />
      </Suspense>
      {/* Only while something on this list can still change on its own. */}
      {entries.some((entry) => !isTerminal(entry.ownership)) && <AutoRefresh seconds={45} />}

      <main className="main register-page enter">
        <header className="register-head">
          <div className="stack-3">
            <p className="eyebrow">The register</p>
            <h1 className="display">Domains</h1>
            {entries.length > 0 && <Tally entries={entries} />}
          </div>
          <AddDomainDialog
            action={claimDomain}
            {...(error !== undefined && { error })}
            {...(attempted !== undefined && { attempted })}
          />
        </header>

        {entries.length === 0 ? (
          <NothingClaimedYet />
        ) : (
          <RegisterTable
            entries={entries}
            now={clock}
            release={releaseDomain}
            remove={removeFromList}
          />
        )}

        {entries.length > 0 && (
          <p className="table-foot">
            {entries.length} {entries.length === 1 ? 'domain' : 'domains'} on record
          </p>
        )}
      </main>

      <Footer />
    </div>
  )
}
