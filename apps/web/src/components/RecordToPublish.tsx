import { CHALLENGE_LABEL, RESOLVERS, type Domain, type Timestamp } from '@deed/core'
import { preflight, randomProbeLabel } from '@deed/dns'
import type { Db } from '@deed/db'
import { RESOLVER_NAMES, fieldLabels, humanTtl, matrixSummary, warningCopy } from '@/lib/copy'
import { router } from '@/lib/verification'
import { CopyButton } from '@/components/CopyButton'
import { RecordBadge } from '@/components/StatusBadge'
import { answersFor } from '@/lib/resolvers'

/**
 * The instruction card, held behind its own Suspense boundary because it is the
 * only part of the page that has to wait: `preflight` is nine live lookups with
 * a three-second ceiling, and awaiting it in the page body meant the domain
 * name, the badge, the guidance and the log all waited with it.
 *
 * The whole card streams rather than only the provider note, because the labels
 * decide which form of the host is shown — filling that in with a guess and
 * correcting it afterwards would move the one string the user is copying.
 */
export async function RecordToPublish({
  db,
  domain,
  value,
  host,
  now,
}: {
  db: Db
  domain: Domain
  value: string
  host: string
  now: Timestamp
}) {
  // Only while a claim is pending: this is when instructions are read, and it
  // costs nine extra lookups.
  const zoneInfo =
    domain.ownership.status === 'pending'
      ? await preflight(await router(db)(domain.name), domain.name, {
          now,
          probeLabel: randomProbeLabel(),
          timeoutMs: 3_000,
        }).catch(() => null)
      : null

  const labels = fieldLabels(zoneInfo?.provider ?? null)
  const relativeHost = `${CHALLENGE_LABEL}${
    domain.name.split('.').length > 2 ? `.${domain.name.split('.').slice(0, -2).join('.')}` : ''
  }`

  return (
    <section className="card">
      <div className="card-header row-between">
        <h2 className="t-section">
          {domain.ownership.status === 'pending' ? 'The record to publish' : 'The record'}
        </h2>
        <span className="t-small subtle">one TXT record · read-only queries</span>
      </div>
      <div className="card-body">
        <RecordTable
          host={labels.relativeHost ? relativeHost : host}
          suffix={labels.relativeHost ? `.${domain.name}` : null}
          value={value}
          hostLabel={labels.host}
          valueLabel={labels.value}
          domain={domain}
        />

        <ResolverEvidence domain={domain} />

        {zoneInfo?.provider != null && (
          <p className="t-small subtle" style={{ marginTop: 'var(--space-3)' }}>
            Field names are {zoneInfo.provider.name}’s, because that is whose panel your nameservers
            say you are about to open.
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
          {labels.relativeHost
            ? 'The greyed part is your domain, which the panel adds itself — Copy gives you only the part it wants. Paste the value without quotes.'
            : 'This panel wants the whole name, so Copy gives you the whole name. Paste the value without quotes.'}
        </p>
      </div>
    </section>
  )
}

/** The card's own geometry, so what arrives replaces something the same shape. */
export function RecordToPublishSkeleton() {
  return (
    <section className="card">
      <div className="card-header row-between">
        <h2 className="t-section">The record to publish</h2>
        <span className="t-small subtle">reading your zone…</span>
      </div>
      <div className="card-body stack-3">
        <div className="skeleton" style={{ height: 16, width: '40%' }} />
        <div className="skeleton" style={{ height: 42, borderRadius: 'var(--radius-md)' }} />
      </div>
    </section>
  )
}

/**
 * Type, host, value — eleven of eleven products surveyed use exactly these
 * three columns in this order. Split out from the async card above so it can be
 * rendered and asserted without performing live DNS.
 */
export function RecordTable({
  host,
  suffix,
  value,
  hostLabel,
  valueLabel,
  domain,
}: {
  host: string
  /**
   * The zone the panel appends for you, or null when this panel wants the whole
   * name. Rendered outside what Copy hands over: read the absolute name, copy
   * the relative one. Of eleven products, none offers a toggle, and the ones
   * that print the absolute name are exactly the ones that ship a warning about
   * `_x.example.com.example.com`.
   */
  suffix: string | null
  value: string
  hostLabel: string
  valueLabel: string
  /**
   * When given, the table also carries the record's status and the evidence
   * behind it — which is what let the "What your DNS says" card go. Optional so
   * the table can be rendered and asserted on its own.
   */
  domain?: Domain
}) {
  return (
    <div className="table-wrap">
      <table className="dns-record">
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">{hostLabel}</th>
            <th scope="col">{valueLabel}</th>
            {domain !== undefined && (
              <th scope="col" className="status">
                Status
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="type">TXT</td>
            <td className="host">
              <div className="cell">
                <span className="t-mono">
                  {host}
                  {suffix !== null && <span className="zone-suffix">{suffix}</span>}
                </span>
                <CopyButton value={host} label="host" compact />
              </div>
            </td>
            {/* Never truncated, in any state. `truncated` is a MismatchCause
                this product diagnoses — "The panel cut the value short" — so
                cutting it ourselves would be committing the bug we report, and
                ValueDiff assumes the whole string is on screen. */}
            <td className="value">
              <div className="cell">
                <span className="t-mono">{value}</span>
                <CopyButton value={value} label="value" compact />
              </div>
            </td>
            {domain !== undefined && (
              <td className="status">
                <RecordBadge record={domain.record} />
              </td>
            )}
          </tr>
        </tbody>

      </table>
    </div>
  )
}

/**
 * The evidence for the row above it, in its own table.
 *
 * It briefly shared the record's `<table>` as a second `<tbody>`, which was a
 * mistake you can only see rendered: the two have different columns — Type /
 * Host / Value / Status against Resolver / Answer / Cached for — so colSpan
 * pushed "4 hours" out under the value and squeezed the resolver names into a
 * two-line column. Same card, because a record's evidence belongs to the
 * record; separate tables, because they are not the same shape.
 */
export function ResolverEvidence({ domain }: { domain: Domain }) {
  const answers = answersFor(domain)

  return (
    <div className="evidence">
      <p className="t-small subtle">{matrixSummary(domain.record)}</p>
      <div className="table-wrap">
        <table className="matrix">
          <caption className="sr-only">What each resolver answered</caption>
          <thead>
            <tr>
              <th scope="col">Resolver</th>
              <th scope="col">Answer</th>
              <th scope="col" className="num">
                Cached for
              </th>
            </tr>
          </thead>
          <tbody>
            {RESOLVERS.map((resolver) => {
              const answer = answers[resolver]
              return (
                <tr key={resolver} {...(answer.state !== 'idle' && { 'data-state': answer.state })}>
                  <th scope="row">
                    <span className="mdot" aria-hidden="true" />
                    {RESOLVER_NAMES[resolver]}
                  </th>
                  <td className="said">{answer.label}</td>
                  <td className="num">{answer.ttl === null ? '—' : humanTtl(answer.ttl)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
