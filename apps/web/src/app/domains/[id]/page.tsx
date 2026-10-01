import { Suspense } from 'react'
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
import { getDomain, loadZone } from '@deed/db'
import type { SandboxZone } from '@deed/dns'
import { session } from '@/lib/session'
import { revalidateIfDue } from '@/lib/verification'
import { verdict } from '@/lib/verdict'
import { ValueDiff } from '@/components/ValueDiff'
import { DeedHeader } from '@/components/DeedHeader'
import { VerdictBanner } from '@/components/VerdictBanner'
import { SandboxZonePanel } from '@/components/SandboxZonePanel'
import { Footer } from '@/components/Footer'
import { Notices } from '@/components/Notices'
import { AutoRefresh } from '@/components/AutoRefresh'
import { TopBar } from '@/components/TopBar'
import { RowActions } from '@/components/RowActions'
import { checkNow, releaseDomain, removeFromList } from '../actions'
import { RecordToPublish, RecordToPublishSkeleton } from '@/components/RecordToPublish'
import { SubmitButton } from '@/components/SubmitButton'

export const dynamic = 'force-dynamic'

export default async function DomainPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ just?: string }>
}) {
  const current = await session()
  if (current === null) redirect('/')

  const { id } = await params
  const { just } = await searchParams
  const found = await getDomain(current.db, asDomainId(id))
  if (found === null) notFound()

  const { domain, justVerified } = await revalidateIfDue(current.db, found)
  const clock = at(Date.now())

  const token = activeToken(domain.ownership)
  const host = challengeHost(domain.name)
  const value = token === null ? null : expectedValue(token)
  const closed = isTerminal(domain.ownership)

  const zone = domain.isSandbox
    ? ((await loadZone(current.db, domain.id)) as SandboxZone | null)
    : null

  const parsedName = parseClaim(domain.name)
  const unicode = parsedName.ok ? parsedName.value.unicode : null

  const mismatch = domain.record.status === 'mismatch' ? domain.record : null
  const offending = mismatch?.observed.find((o) => o.kind === 'unknown') ?? null

  // Either path can be the one that proved it: the lazy check this render just
  // performed, or a manual check that redirected here.
  const said = verdict(domain, justVerified || just === 'verified')

  return (
    <div className="shell">
      <TopBar
        email={current.email}
        trail={[{ label: 'Domains', href: '/domains' }, { label: domain.name, mono: true }]}
      />
      <Suspense fallback={null}>
        <Notices />
      </Suspense>
      {/* Pending is where the user waits, so it is where the page has to move.
          A closed claim never changes again and is left alone. */}
      {!closed && <AutoRefresh seconds={domain.ownership.status === 'pending' ? 20 : 45} />}

      <main className="main deed enter">
        <DeedHeader
          domain={domain}
          now={clock}
          closed={closed}
          unicode={unicode}
          actions={
            <>
              {!closed && (
                <form action={checkNow}>
                  <input type="hidden" name="id" value={domain.id} />
                  <SubmitButton className="btn btn-secondary" pendingLabel="Checking…">
                    <RecheckIcon />
                    Check now
                  </SubmitButton>
                </form>
              )}
              {/* The same menu the list row carries, so a closed claim still has
                  somewhere to be removed from the list from. */}
              <RowActions
                domainId={domain.id}
                name={domain.name}
                state={closed ? 'closed' : 'live'}
                requireTyping={isExclusive(domain.ownership)}
                release={releaseDomain}
                remove={removeFromList}
              />
            </>
          }
        />

        <VerdictBanner verdict={said} />

        {/* A closed claim has no record to publish and nothing left to check.
            The badge and the meta above say what became of it; there is no
            second half of the page to switch to. */}
        {!closed && (
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
            {zone !== null && <SandboxZonePanel domain={domain} zone={zone} expected={value} />}
          </>
        )}
      </main>

      <Footer />
    </div>
  )
}

function RecheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
