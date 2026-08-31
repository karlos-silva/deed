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
import { claimGuidance, humanSince, humanUntil, recordGuidance } from '@/lib/copy'
import { revalidateIfDue } from '@/lib/verification'
import { ClaimBadge, RecordBadge } from '@/components/StatusBadge'
import { ResolverMatrix } from '@/components/ResolverMatrix'
import { ValueDiff } from '@/components/ValueDiff'
import { AuditLog } from '@/components/AuditLog'
import { SandboxZonePanel } from '@/components/SandboxZonePanel'
import { Footer } from '@/components/Footer'
import { Notices } from '@/components/Notices'
import { AutoRefresh } from '@/components/AutoRefresh'
import { TopBar } from '@/components/TopBar'
import { checkNow, releaseDomain, removeFromList, restoreToList, rotateToken } from '../actions'
import { ReleaseDialog } from '@/components/ReleaseDialog'
import {
  RecordToPublish,
  RecordToPublishSkeleton,
} from '@/components/RecordToPublish'
import { SubmitButton } from '@/components/SubmitButton'

export const dynamic = 'force-dynamic'

export default async function DomainPage({ params }: { params: Promise<{ id: string }> }) {
  const current = await session()
  if (current === null) redirect('/')

  const { id } = await params
  const found = await getDomain(current.db, asDomainId(id))
  if (found === null) notFound()

  const { domain, hiddenAt } = await revalidateIfDue(current.db, found)
  const clock = at(Date.now())

  const record = recordGuidance(domain)
  const claim = claimGuidance(domain.ownership)
  const token = activeToken(domain.ownership)
  const host = challengeHost(domain.name)
  const value = token === null ? null : expectedValue(token)

  const [audit, zone] = await Promise.all([
    listTimeline(current.db, domain.id, { limit: 20 }),
    domain.isSandbox
      ? (loadZone(current.db, domain.id) as Promise<SandboxZone | null>)
      : Promise.resolve(null),
  ])

  const parsedName = parseClaim(domain.name)
  const unicode = parsedName.ok ? parsedName.value.unicode : null

  const closed = isTerminal(domain.ownership)
  const mismatch = domain.record.status === 'mismatch' ? domain.record : null
  const offending = mismatch?.observed.find((o) => o.kind === 'unknown') ?? null

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
              <ClaimBadge ownership={domain.ownership} />
              {domain.isSandbox && <span className="badge badge-info">simulated zone</span>}
            </div>
            {unicode !== null && (
              <p className="t-small subtle">
                Displays as <span className="t-mono">{unicode}</span>. Stored and compared as
                punycode, so two names that look alike can never be confused.
              </p>
            )}
            <p className="t-small subtle">
              {closed
                ? domain.lastCheckedAt === null
                  ? 'This claim closed without a check ever completing.'
                  : `Last checked ${humanSince(domain.lastCheckedAt, clock)}. Checking has stopped.`
                : `${
                    domain.lastCheckedAt === null
                      ? 'No check has completed yet.'
                      : `Last checked ${humanSince(domain.lastCheckedAt, clock)}.`
                  }${
                    domain.nextCheckAt !== null
                      ? ` Next automatic check ${
                          domain.nextCheckAt <= clock ? 'due now' : humanUntil(clock, domain.nextCheckAt)
                        }.`
                      : ''
                  }`}
            </p>
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
          </div>
        </div>

        {claim !== null && (
          <section className={`callout callout-${claim.tone === 'problem' ? 'danger' : 'info'}`}>
            <div className="guidance">
              <strong className="headline">{claim.headline}</strong>
              <p className="body">{claim.body}</p>
              {claim.fix !== undefined && <p className="fix">{claim.fix}</p>}
            </div>
          </section>
        )}

        {closed ? (
          <section className="card">
            <div className="card-header">
              <h2 className="t-section">What your DNS said</h2>
            </div>
            <div className="card-body">
              <p className="t-small subtle">
                {domain.lastCheckedAt === null
                  ? 'No check ever completed for this claim.'
                  : `The last check ran ${humanSince(domain.lastCheckedAt, clock)}. Nothing has been checked since, and nothing will be — a closed claim has no proof to keep.`}
              </p>
            </div>
          </section>
        ) : (
        <section className="card">
          <div className="card-header row-between">
            <h2 className="t-section">What your DNS says</h2>
            <RecordBadge record={domain.record} />
          </div>
          <div className="card-body stack">
            <div className="guidance">
              <strong className="headline">{record.headline}</strong>
              <p className="body">{record.body}</p>
              {record.fix !== undefined && <p className="fix">{record.fix}</p>}
              <p className="verdict-line">
                {record.waitingHelps === null
                  ? 'nothing to wait for'
                  : record.waitingHelps
                    ? 'waiting helps'
                    : 'waiting will not fix this'}
              </p>
            </div>

            {offending !== null && value !== null && (
              <ValueDiff expected={value} observed={offending.value} />
            )}

            <ResolverMatrix domain={domain} />
          </div>
        </section>
        )}

        {value !== null && (
          <Suspense fallback={<RecordToPublishSkeleton />}>
            <RecordToPublish
              db={current.db}
              domain={domain}
              value={value}
              host={host}
              now={clock}
            />
          </Suspense>
        )}

        {/* Directly under the record it replaces, not in the destructive
            footer. Rotation is two-part — retire the old value AND receive the
            new one — and none of the eight products surveyed strands it away
            from the value it hands back: Stripe, Supabase, Vercel and GitHub
            all keep it on the page that shows the credential. It is also
            routine, so it keeps the default button variant; the only red on
            this page belongs to Release. */}
        {token !== null && (
          <section className="card">
            <div className="card-header">
              <h2 className="t-section">Rotate the token</h2>
            </div>
            <div className="card-body card-action">
              <p className="t-small subtle">
                If this token leaked — a public gist, a screenshot — replace it. The new value
                appears in the record above, and the old one keeps being tolerated only until its
                cache clears, then stops proving anything. You keep the domain.
              </p>
              <form action={rotateToken}>
                <input type="hidden" name="id" value={domain.id} />
                <SubmitButton pendingLabel="Issuing…">Issue a new token</SubmitButton>
              </form>
            </div>
          </section>
        )}

        {/* A closed claim has no token, so the Value field would render blank
            with nothing to explain it, and every write would run a real check
            against a claim that is finished. */}
        {zone !== null && !closed && (
          <SandboxZonePanel domain={domain} zone={zone} expected={value} />
        )}

        <section className="card">
          <div className="card-header row-between">
            <h2 className="t-section">Everything we did</h2>
            <span className="t-small subtle">newest first</span>
          </div>
          <div className="card-body">
            <AuditLog entries={audit.entries} now={clock} />
          </div>
        </section>

        {isTerminal(domain.ownership) && (
          <section className="card">
            <div className="card-header">
              <h2 className="t-section">This claim is closed</h2>
            </div>
            <div className="card-body card-action">
              <p className="t-small subtle">
                {hiddenAt === null
                  ? 'Nothing here can change again. You can take it off your list without losing any of this — the log stays, at this address.'
                  : `Removed from your list on ${new Date(hiddenAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. The log is untouched.`}
              </p>
              {hiddenAt === null ? (
                <form action={removeFromList}>
                  <input type="hidden" name="id" value={domain.id} />
                  <SubmitButton pendingLabel="Removing…">Remove from list</SubmitButton>
                </form>
              ) : (
                <form action={restoreToList}>
                  <input type="hidden" name="id" value={domain.id} />
                  <SubmitButton pendingLabel="Restoring…">Restore to list</SubmitButton>
                </form>
              )}
            </div>
          </section>
        )}

        {/* Its own section at the bottom, named after what it does. Grouping is
            by object scope: this acts on the claim's existence, so it sits with
            nothing else and carries the only destructive treatment on the page. */}
        {!closed && (
          <section className="card card-danger">
            <div className="card-header">
              <h2 className="t-section">Release this domain</h2>
            </div>
            <div className="card-body card-action">
              <p className="t-small subtle">
                The name goes back to the pool and anyone can prove it from that moment. Your
                history stays readable here afterwards.
              </p>
              <ReleaseDialog
                action={releaseDomain}
                domainId={domain.id}
                name={domain.name}
                requireTyping={isExclusive(domain.ownership)}
              />
            </div>
          </section>
        )}

      </main>

      <Footer />
    </div>
  )
}
