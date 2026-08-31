import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  CHALLENGE_LABEL,
  activeToken,
  at,
  isExclusive,
  isTerminal,
  challengeHost,
  expectedValue,
  domainId as asDomainId,
  parseClaim,
} from '@deed/core'
import { getDomain, listAudit, loadZone } from '@deed/db'
import { type SandboxZone, preflight, randomProbeLabel } from '@deed/dns'
import { session } from '@/lib/session'
import { claimGuidance, fieldLabels, humanSince, humanUntil, recordGuidance, warningCopy } from '@/lib/copy'
import { revalidateIfDue, router } from '@/lib/verification'
import { ClaimBadge, RecordBadge } from '@/components/StatusBadge'
import { CopyButton } from '@/components/CopyButton'
import { ResolverMatrix } from '@/components/ResolverMatrix'
import { ValueDiff } from '@/components/ValueDiff'
import { AuditLog } from '@/components/AuditLog'
import { SandboxZonePanel } from '@/components/SandboxZonePanel'
import { Footer } from '@/components/Footer'
import { Notices } from '@/components/Notices'
import { TopBar } from '@/components/TopBar'
import { checkNow, releaseDomain, removeFromList, restoreToList, rotateToken } from '../actions'
import { ReleaseDialog } from '@/components/ReleaseDialog'

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
    listAudit(current.db, domain.id, { limit: 25 }),
    domain.isSandbox
      ? (loadZone(current.db, domain.id) as Promise<SandboxZone | null>)
      : Promise.resolve(null),
  ])

  const parsedName = parseClaim(domain.name)
  const unicode = parsedName.ok ? parsedName.value.unicode : null

  // Only while a claim is pending: this is when instructions are read, and it costs nine extra lookups.
  const zoneInfo =
    domain.ownership.status === 'pending'
      ? await preflight(await router(current.db)(domain.name), domain.name, {
          now: clock,
          probeLabel: randomProbeLabel(),
          timeoutMs: 3_000,
        }).catch(() => null)
      : null
  const labels = fieldLabels(zoneInfo?.provider ?? null)
  const relativeHost = `${CHALLENGE_LABEL}${
    domain.name.split('.').length > 2 ? `.${domain.name.split('.').slice(0, -2).join('.')}` : ''
  }`

  const mismatch = domain.record.status === 'mismatch' ? domain.record : null
  const offending = mismatch?.observed.find((o) => o.kind === 'unknown') ?? null

  return (
    <div className="shell">
      <TopBar email={current.email} />
      <Suspense fallback={null}>
        <Notices />
      </Suspense>

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
              {domain.lastCheckedAt === null
                ? 'No check has completed yet.'
                : `Last checked ${humanSince(domain.lastCheckedAt, clock)}.`}{' '}
              {domain.nextCheckAt !== null &&
                `Next automatic check ${
                  domain.nextCheckAt <= clock ? 'due now' : humanUntil(clock, domain.nextCheckAt)
                }.`}
            </p>
          </div>

          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Link className="btn btn-ghost btn-sm" href="/domains">
              All domains
            </Link>
            <form action={checkNow}>
              <input type="hidden" name="id" value={domain.id} />
              <button className="btn btn-secondary btn-sm" type="submit">
                Check now
              </button>
            </form>
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

        {value !== null && (
          <section className="card">
            <div className="card-header row-between">
              <h2 className="t-section">The record to publish</h2>
              <span className="t-small subtle">one TXT record · read-only queries</span>
            </div>
            <div className="card-body">
              <dl className="record">
                <dt>Type</dt>
                <dd>TXT</dd>
                <dd />

                <dt>{labels.host}</dt>
                <dd>{labels.relativeHost ? relativeHost : host}</dd>
                <dd>
                  <CopyButton value={labels.relativeHost ? relativeHost : host} label="host" />
                </dd>

                <dt>{labels.relativeHost ? 'Full host' : 'Relative'}</dt>
                <dd className="subtle">{labels.relativeHost ? host : relativeHost}</dd>
                <dd />

                <dt>{labels.value}</dt>
                <dd>{value}</dd>
                <dd>
                  <CopyButton value={value} label="value" />
                </dd>
              </dl>

              {zoneInfo?.provider != null && (
                <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
                  Field names are {zoneInfo.provider.name}’s, because that is whose panel your
                  nameservers say you are about to open.
                </p>
              )}

              {(zoneInfo?.warnings ?? []).map(warningCopy).map((warning, index) => (
                <div
                  key={index}
                  className={`callout callout-${warning.tone === 'problem' ? 'warning' : 'info'}`}
                  style={{ marginTop: 'var(--space-3)' }}
                >
                  <div className="guidance">
                    <strong className="headline" style={{ fontSize: 'var(--text-base)' }}>
                      {warning.headline}
                    </strong>
                    <p className="body">{warning.body}</p>
                    {warning.fix !== undefined && <p className="fix">{warning.fix}</p>}
                  </div>
                </div>
              ))}

              <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
                Most panels want the name without the domain; both forms are above. Paste the value
                without quotes — the panel adds its own.
              </p>
            </div>
          </section>
        )}

        {zone !== null && <SandboxZonePanel domain={domain} zone={zone} expected={value} />}

        <section className="card">
          <div className="card-header row-between">
            <h2 className="t-section">Everything we did</h2>
            <span className="t-small subtle">newest first</span>
          </div>
          <div className="card-body">
            <AuditLog events={audit.events} now={clock} />
          </div>
        </section>

        {isTerminal(domain.ownership) && (
          <section className="card">
            <div className="card-header">
              <h2 className="t-section">This claim is closed</h2>
            </div>
            <div className="card-body stack-3">
              <p className="t-small subtle">
                {hiddenAt === null
                  ? 'Nothing here can change again. You can take it off your list without losing any of this — the log stays, at this address.'
                  : `Removed from your list on ${new Date(hiddenAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. The log is untouched.`}
              </p>
              {hiddenAt === null ? (
                <form action={removeFromList}>
                  <input type="hidden" name="id" value={domain.id} />
                  <button className="btn btn-secondary btn-sm" type="submit">
                    Remove from list
                  </button>
                </form>
              ) : (
                <form action={restoreToList}>
                  <input type="hidden" name="id" value={domain.id} />
                  <button className="btn btn-secondary btn-sm" type="submit">
                    Restore to list
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {token !== null && (
          <section className="card">
            <div className="card-header">
              <h2 className="t-section">Recovery</h2>
            </div>
            <div className="card-body grid-2">
              <form action={rotateToken} className="stack-2">
                <input type="hidden" name="id" value={domain.id} />
                <strong className="t-body">Rotate the token</strong>
                <p className="t-small subtle">
                  If this token leaked — a public gist, a screenshot — replace it. The old value
                  keeps being tolerated only until its cache clears, then stops proving anything.
                  You keep the domain.
                </p>
                <button className="btn btn-secondary btn-sm" type="submit">
                  Issue a new token
                </button>
              </form>

              <div className="stack-2">
                <strong className="t-body">Release this domain</strong>
                <p className="t-small subtle">
                  This frees the name for anyone else to claim and prove. Your history stays
                  readable here afterwards.
                </p>
                <ReleaseDialog
                  action={releaseDomain}
                  domainId={domain.id}
                  name={domain.name}
                  requireTyping={isExclusive(domain.ownership)}
                />
              </div>
            </div>
          </section>
        )}
      </main>

      <Footer />
    </div>
  )
}
