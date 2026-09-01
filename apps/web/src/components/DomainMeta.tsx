import type { Domain, RecordState } from '@deed/core'
import { humanSince, humanUntil } from '@/lib/copy'
import { ClaimBadge } from '@/components/StatusBadge'

/**
 * The facts about this claim, as labelled values rather than as sentences. The
 * page used to carry them in prose — a freshness paragraph under the title, a
 * second one in the closed branch saying the same thing in different words, and
 * a status badge duplicated on both sides of the fold.
 *
 * No provider cell: `preflight` runs only while a claim is pending, so provider
 * is a fact that would appear in one state and vanish in the next, and buying
 * stability for it means live DNS on every page view. It keeps doing real work
 * where it belongs — naming the columns of the record table.
 */
export function DomainMeta({
  domain,
  now,
  closed,
}: {
  domain: Domain
  now: number
  closed: boolean
}) {
  return (
    <div className="meta-row">
      <Item label="Claimed" value={humanSince(domain.createdAt, now)} />

      <Item label="Status" value={<ClaimBadge ownership={domain.ownership} />} />

      <Item label="Resolvers" value={<span className="tabular">{seenCount(domain.record)}</span>} />

      <Item label="Last checked" value={freshness(domain, now, closed)} />

      {/* A closed claim shows no cell rather than an em dash, which is why its
          page needs no sentence explaining that checking has stopped. */}
      {!closed && <Item label="Next check" value={nextCheck(domain, now)} />}
    </div>
  )
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="meta-item">
      <span className="t-label">{label}</span>
      <div className="meta-value">{value}</div>
    </div>
  )
}

/** How many of the three currently answer with the token that is live now. */
export function seenCount(record: RecordState): string {
  switch (record.status) {
    case 'verified':
    case 'propagating':
      return `${record.seenBy.length} of 3`
    case 'mismatch':
      return `${record.observed.filter((o) => o.kind === 'current').length} of 3`
    case 'absent':
    case 'zone_error':
      return '0 of 3'
    case 'unchecked':
    case 'check_failed':
      return '—'
  }
}

function freshness(domain: Domain, now: number, closed: boolean): string {
  if (domain.lastCheckedAt === null) return closed ? 'never' : 'no check yet'
  const since = humanSince(domain.lastCheckedAt, now)
  return closed ? `${since} · stopped` : since
}

function nextCheck(domain: Domain, now: number): string {
  if (domain.nextCheckAt === null) return 'not scheduled'
  return domain.nextCheckAt <= now ? 'due now' : humanUntil(now, domain.nextCheckAt)
}
