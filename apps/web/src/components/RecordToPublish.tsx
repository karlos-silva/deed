import { CHALLENGE_LABEL, type Domain, type Timestamp } from '@deed/core'
import { preflight, randomProbeLabel } from '@deed/dns'
import type { Db } from '@deed/db'
import { fieldLabels, warningCopy } from '@/lib/copy'
import { router } from '@/lib/verification'
import { CopyButton } from '@/components/CopyButton'

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
          Most panels want the name without the domain; both forms are above. Paste the value
          without quotes — the panel adds its own.
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
        <div className="skeleton" style={{ height: 18, width: '30%' }} />
        <div className="skeleton" style={{ height: 18, width: '55%' }} />
        <div className="skeleton" style={{ height: 18, width: '80%' }} />
      </div>
    </section>
  )
}
