import type { Domain } from '@deed/core'
import { CHALLENGE_LABEL } from '@deed/core'
import { SANDBOX_DELAY, type SandboxZone } from '@deed/dns'
import { addZoneRecord, removeZoneRecord, setZoneOutage } from '@/app/domains/actions'
import { RESOLVER_NAMES } from '@/lib/copy'

const OUTAGES = [
  { value: '', label: 'Answering normally' },
  { value: 'servfail', label: 'SERVFAIL — their zone fails to answer' },
  { value: 'refused', label: 'REFUSED — their nameservers refuse' },
  { value: 'dnssec', label: 'DNSSEC validation failure' },
  { value: 'timeout', label: 'Our lookup times out' },
  { value: 'throttled', label: 'Our lookup is rate limited' },
] as const

export function SandboxZonePanel({
  domain,
  zone,
  expected,
}: {
  domain: Domain
  zone: SandboxZone
  expected: string | null
}) {
  const live = zone.records.filter((record) => record.deletedAt === null)
  const clearing = zone.records.filter((record) => record.deletedAt !== null)

  return (
    <section className="card">
      <div className="card-header row-between">
        <h2 className="t-section">The simulated zone</h2>
        <span className="t-small subtle">
          you are the DNS admin · {Object.entries(SANDBOX_DELAY)
            .map(([resolver, delay]) => `${RESOLVER_NAMES[resolver as keyof typeof SANDBOX_DELAY].split(' ')[0]} +${delay / 1000}s`)
            .join(' · ')}
        </span>
      </div>

      <div className="card-body stack">
        <p className="t-small subtle">
          This zone exists only here — <span className="t-mono">.test</span> can never resolve in
          real DNS, so a simulated verification can never be mistaken for a real one. Each resolver
          adopts a change after its own delay, exactly as a real cache would.
        </p>

        <div className="table-wrap">
          <table className="zone-table">
            <thead>
              <tr>
                <th>Host</th>
                <th>Type</th>
                <th>Value</th>
                <th>TTL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {live.length === 0 && clearing.length === 0 && (
                <tr>
                  <td colSpan={5} className="subtle" style={{ fontFamily: 'var(--font-sans)' }}>
                    The zone is empty — which is exactly what “not found” looks like.
                  </td>
                </tr>
              )}

              {live.map((record) => (
                <tr key={record.id}>
                  <td>{record.host}</td>
                  <td>{record.type}</td>
                  <td className="wrap-anywhere">{record.value}</td>
                  <td>{record.ttl}</td>
                  <td className="actions">
                    <form action={removeZoneRecord}>
                      <input type="hidden" name="id" value={domain.id} />
                      <input type="hidden" name="record" value={record.id} />
                      <button className="btn btn-ghost btn-sm" type="submit">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}

              {clearing.map((record) => (
                <tr key={record.id} style={{ opacity: 0.55 }}>
                  <td>{record.host}</td>
                  <td>{record.type}</td>
                  <td className="wrap-anywhere">{record.value}</td>
                  <td>{record.ttl}</td>
                  <td className="actions subtle">clearing from caches</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form action={addZoneRecord} className="zone-form">
          <input type="hidden" name="id" value={domain.id} />
          <div className="field">
            <label className="t-label" htmlFor="host">
              Host
            </label>
            <input
              className="input"
              id="host"
              name="host"
              defaultValue={CHALLENGE_LABEL}
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ flex: '0 0 96px' }}>
            <label className="t-label" htmlFor="type">
              Type
            </label>
            <select className="input" id="type" name="type" defaultValue="TXT">
              <option>TXT</option>
              <option>CNAME</option>
              <option>A</option>
            </select>
          </div>
          <div className="field wide">
            <label className="t-label" htmlFor="value">
              Value
            </label>
            <input
              className="input t-mono"
              id="value"
              name="value"
              defaultValue={expected ?? ''}
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ flex: '0 0 88px' }}>
            <label className="t-label" htmlFor="ttl">
              TTL
            </label>
            <input className="input" id="ttl" name="ttl" type="number" defaultValue={300} min={1} />
          </div>
          <button className="btn btn-secondary" type="submit">
            Add record
          </button>
        </form>

        <div className="divider" />

        <form action={setZoneOutage} className="zone-form">
          <input type="hidden" name="id" value={domain.id} />
          <div className="field wide">
            <label className="t-label" htmlFor="outage">
              Make the zone fail
            </label>
            <select className="input" id="outage" name="outage" defaultValue={zone.outage ?? ''}>
              {OUTAGES.map((outage) => (
                <option key={outage.value} value={outage.value}>
                  {outage.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" type="submit">
            Apply
          </button>
        </form>

        <p className="t-small subtle">
          The last two are <em>our</em> failure, not yours — pick one and watch the product refuse
          to conclude anything about your zone.
        </p>
      </div>
    </section>
  )
}
