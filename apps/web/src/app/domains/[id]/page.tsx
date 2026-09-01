import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  activeToken,
  at,
  isExclusive,
  isTerminal,
  challengeHost,
  expectedValue,
  domainId as asDomainId,
  parseClaim,
} from '@deed/core'
import { getDomain, listTimeline, loadZone } from '@deed/db'
import type { SandboxZone } from '@deed/dns'
import { session } from '@/lib/session'
import { revalidateIfDue } from '@/lib/verification'
import { verdict } from '@/lib/verdict'
import { ValueDiff } from '@/components/ValueDiff'
import { AuditLog } from '@/components/AuditLog'
import { DomainMeta } from '@/components/DomainMeta'
import { VerdictBanner } from '@/components/VerdictBanner'
import { SandboxZonePanel } from '@/components/SandboxZonePanel'
import { Footer } from '@/components/Footer'
import { Notices } from '@/components/Notices'
import { AutoRefresh } from '@/components/AutoRefresh'
import { TopBar } from '@/components/TopBar'
import { RowActions } from '@/components/RowActions'
import { checkNow, releaseDomain, removeFromList, restoreToList } from '../actions'
import { RecordToPublish, RecordToPublishSkeleton } from '@/components/RecordToPublish'
import { SubmitButton } from '@/components/SubmitButton'

export const dynamic = 'force-dynamic'

export default async function DomainPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string; just?: string }>
}) {
  const current = await session()
  if (current === null) redirect('/')

  const { id } = await params
  const { view, just } = await searchParams
  const found = await getDomain(current.db, asDomainId(id))
  if (found === null) notFound()

  const { domain, hiddenAt, justVerified } = await revalidateIfDue(current.db, found)
  const clock = at(Date.now())

  const token = activeToken(domain.ownership)
  const host = challengeHost(domain.name)
  const value = token === null ? null : expectedValue(token)
  const closed = isTerminal(domain.ownership)

  // A closed claim has no record to publish and nothing left to check, so its
  // history is not one tab of two — it is the page (S7, D19).
  const showing = closed || view === 'activity' ? 'activity' : 'records'

  const [audit, zone] = await Promise.all([
    showing === 'activity'
      ? listTimeline(current.db, domain.id, { limit: 20 })
      : Promise.resolve(null),
    domain.isSandbox
      ? (loadZone(current.db, domain.id) as Promise<SandboxZone | null>)
      : Promise.resolve(null),
  ])

  const parsedName = parseClaim(domain.name)
  const unicode = parsedName.ok ? parsedName.value.unicode : null

  const mismatch = domain.record.status === 'mismatch' ? domain.record : null
  const offending = mismatch?.observed.find((o) => o.kind === 'unknown') ?? null

  // Either path can be the one that proved it: the lazy check this render just
  // performed, or a manual check that redirected here.
  const said = verdict(domain, justVerified || just === 'verified')

  return (
    <div className="shell">
      <TopBar email={current.email} />
      <Suspense fallback={null}>
        <Notices />
      </Suspense>
      {/* Pending is where the user waits, so it is where the page has to move.
          A closed claim never changes again and is left alone. */}
      {!closed && <AutoRefresh seconds={domain.ownership.status === 'pending' ? 20 : 45} />}

      <main className="main stack-6">
        <div className="page-head">
          <div className="stack-2">
            <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <h1 className="t-title t-mono wrap-anywhere">{domain.name}</h1>
              {domain.isSandbox && <span className="badge badge-info">simulated zone</span>}
            </div>
            {unicode !== null && (
              <p className="t-small subtle">
                Displays as <span className="t-mono">{unicode}</span>. Stored and compared as
                punycode, so two names that look alike can never be confused.
              </p>
            )}
          </div>

          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Link className="btn btn-ghost btn-sm" href="/domains">
              All domains
            </Link>
            {!closed && (
              <form action={checkNow}>
                <input type="hidden" name="id" value={domain.id} />
                <SubmitButton pendingLabel="Checking…">Check now</SubmitButton>
              </form>
            )}
            {/* The same menu the list row carries, so a closed claim still has
                somewhere to be removed from the list from. */}
            <RowActions
              domainId={domain.id}
              name={domain.name}
              state={closed ? (hiddenAt === null ? 'closed' : 'removed') : 'live'}
              requireTyping={isExclusive(domain.ownership)}
              release={releaseDomain}
              remove={removeFromList}
              restore={restoreToList}
            />
          </div>
        </div>

        <DomainMeta domain={domain} now={clock} closed={closed} />

        <VerdictBanner verdict={said} />

        {!closed && (
          <nav className="tabs" aria-label="What to show">
            <Link
              className="tab"
              href={`/domains/${domain.id}`}
              aria-current={showing === 'records' ? 'page' : undefined}
            >
              Record
            </Link>
            <Link
              className="tab"
              href={`/domains/${domain.id}?view=activity`}
              aria-current={showing === 'activity' ? 'page' : undefined}
            >
              Activity
            </Link>
          </nav>
        )}

        {showing === 'records' ? (
          <>
            {offending !== null && value !== null && (
              <ValueDiff expected={value} observed={offending.value} />
            )}

            {value !== null &&
              // Only a pending claim pays for preflight, so only a pending claim
              // needs a boundary to wait behind.
              (domain.ownership.status === 'pending' ? (
                <Suspense fallback={<RecordToPublishSkeleton />}>
                  <RecordToPublish
                    db={current.db}
                    domain={domain}
                    value={value}
                    host={host}
                    now={clock}
                  />
                </Suspense>
              ) : (
                <RecordToPublish
                  db={current.db}
                  domain={domain}
                  value={value}
                  host={host}
                  now={clock}
                />
              ))}

            {/* delivery-plan S5: a sandbox domain's page *includes* the simulated
                zone, clearly labelled. That wording is a MUST about the page, so
                it does not go behind a click. */}
            {zone !== null && !closed && (
              <SandboxZonePanel domain={domain} zone={zone} expected={value} />
            )}
          </>
        ) : (
          <section className="card">
            <div className="card-header row-between">
              <h2 className="t-section">Activity</h2>
              <span className="t-small subtle">newest first</span>
            </div>
            <div className="card-body">
              <AuditLog entries={audit?.entries ?? []} now={clock} />
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}
