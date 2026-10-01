import { notFound } from 'next/navigation'
import { RESOLVERS, isTerminal } from '@deed/core'
import { claimGuidance, recordGuidance } from '@/lib/copy'
import { verdict } from '@/lib/verdict'
import { DomainMeta } from '@/components/DomainMeta'
import { VerdictBanner } from '@/components/VerdictBanner'
import { ClaimBadge, RecordBadge } from '@/components/StatusBadge'
import { ValueDiff } from '@/components/ValueDiff'
import { TopBar } from '@/components/TopBar'
import { NothingClaimedYet } from '@/components/NothingClaimedYet'
import { AddDomainDialog } from '@/components/AddDomainDialog'
import { RecordTable, ResolverEvidence } from '@/components/RecordToPublish'
import { claimDomain, releaseDomain, removeFromList } from '@/app/domains/actions'
import { ReleaseDialog } from '@/components/ReleaseDialog'
import { RegisterTable, Tally } from '@/components/Register'
import { Seal } from '@/components/Seal'
import { CLAIMS, ENTRIES, RECORDS, T0, TOKEN, VALUE, domain, ttl } from './fixtures'

export const dynamic = 'force-dynamic'

export default function DesignGallery() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <div className="shell">
      <TopBar email="alan.turing@example.com" trail={[{ label: 'Every state' }]} />

      <main className="main stack-6">
        <div className="stack-2">
          <h1 className="t-title">Every state</h1>
          <p className="t-body muted">
            Development only. Reaching these by hand means owning a domain and breaking it on
            purpose.
          </p>
        </div>

        <Section title="Claim badges">
          <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            {CLAIMS.map(([label, ownership]) => (
              <span key={label} className="row" style={{ gap: 'var(--space-2)' }}>
                <ClaimBadge ownership={ownership} />
                <span className="t-small subtle">{label}</span>
              </span>
            ))}
          </div>
        </Section>

        <Section title="The seal, in every standing">
          <div className="row" style={{ gap: 'var(--space-6)', flexWrap: 'wrap' }}>
            {CLAIMS.slice(0, 5).map(([label, ownership]) => (
              <div key={label} className="stack-2" style={{ justifyItems: 'center' }}>
                <Seal ownership={ownership} />
                <span className="t-small subtle">{label}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="The one verdict, and the facts above it">
          {CLAIMS.map(([label, ownership]) => {
            const d = domain({ status: 'verified', seenBy: [...RESOLVERS], ttl }, ownership)
            return (
              <div key={label} className="stack-3" style={{ marginBottom: 'var(--space-6)' }}>
                <span className="t-small subtle">{label}</span>
                <DomainMeta domain={d} now={T0} closed={isTerminal(ownership)} />
                <VerdictBanner verdict={verdict(d)} />
              </div>
            )
          })}
          <div className="stack-3">
            <span className="t-small subtle">
              verified, on the render that proved it — the one celebratory moment (prd §6.5)
            </span>
            <VerdictBanner
              verdict={verdict(
                domain({ status: 'verified', seenBy: [...RESOLVERS], ttl }, CLAIMS[1]?.[1] ?? {
                  status: 'verified',
                  token: TOKEN,
                  verifiedAt: T0,
                }),
                true,
              )}
            />
          </div>
        </Section>

        <Section title="Claim guidance">
          {CLAIMS.map(([label, ownership]) => {
            const guidance = claimGuidance(ownership)
            if (guidance === null) return null
            return (
              <div key={label} className="callout callout-info" style={{ marginTop: 'var(--space-3)' }}>
                <div className="guidance">
                  <span className="t-small subtle">{label}</span>
                  <strong className="headline">{guidance.headline}</strong>
                  <p className="body">{guidance.body}</p>
                  {guidance.fix !== undefined && <p className="fix">{guidance.fix}</p>}
                </div>
              </div>
            )
          })}
        </Section>

        {RECORDS.map(([label, record]) => {
          const d = domain(record)
          const guidance = recordGuidance(d)
          return (
            <section className="card" key={label}>
              <div className="card-header row-between">
                <h2 className="t-section">{label}</h2>
                <RecordBadge record={record} />
              </div>
              <div className="card-body stack">
                <div className="guidance">
                  <strong className="headline">{guidance.headline}</strong>
                  <p className="body">{guidance.body}</p>
                  {guidance.fix !== undefined && <p className="fix">{guidance.fix}</p>}
                  <p className="verdict-line">
                    {guidance.waitingHelps === null
                      ? 'nothing to wait for'
                      : guidance.waitingHelps
                        ? 'waiting helps'
                        : 'waiting will not fix this'}
                  </p>
                </div>
                {record.status === 'mismatch' && (
                  <ValueDiff expected={VALUE} observed={`"${VALUE}"`} />
                )}
                <ResolverEvidence domain={d} />
              </div>
            </section>
          )
        })}

        <Section title="The record to publish">
          <RecordTable
            host="_deed-challenge.demo"
            suffix=".karlos.dev"
            value={VALUE}
            hostLabel="Host / Name"
            valueLabel="Value"
          />
          <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
            and the same record for a panel that wants the whole name
          </p>
          <div style={{ marginTop: 'var(--space-2)' }}>
            <RecordTable
              host="_deed-challenge.demo.karlos.dev"
              suffix={null}
              value={VALUE}
              hostLabel="Hostname"
              valueLabel="Enter this value"
            />
          </div>
        </Section>

        <Section title="First run">
          <NothingClaimedYet />
        </Section>

        <Section title="The list, and the Add domain dialog">
          <header className="register-head">
            <div className="stack-3">
              <p className="eyebrow">The register</p>
              <h2 className="display">Domains</h2>
              <Tally entries={ENTRIES} />
            </div>
            <AddDomainDialog action={claimDomain} />
          </header>
          <RegisterTable
            entries={ENTRIES}
            now={T0}
            release={releaseDomain}
            remove={removeFromList}
          />
          <p className="table-foot">{ENTRIES.length} domains on record</p>
        </Section>

        <Section title="The release confirmation">
          <div className="row" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <ReleaseDialog
              action={releaseDomain}
              domainId="d"
              name="demo.karlos.dev"
              requireTyping
            />
            <span className="t-small subtle">a proved claim — asks for the name back</span>
          </div>
        </Section>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="card-header">
        <h2 className="t-section">{title}</h2>
      </div>
      <div className="card-body">{children}</div>
    </section>
  )
}
