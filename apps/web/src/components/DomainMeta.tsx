import type { Domain } from '@deed/core'
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
 *
 * No resolver count either. "3 of 3" was the verdict banner's own first clause,
 * forty pixels below it, and of the two the sentence is the one that explains
 * itself. What is left is the part no sentence carries well: when this was last
 * true, and when it will be asked again.
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

function freshness(domain: Domain, now: number, closed: boolean): string {
  if (domain.lastCheckedAt === null) return closed ? 'never' : 'no check yet'
  const since = humanSince(domain.lastCheckedAt, now)
  return closed ? `${since} · stopped` : since
}

function nextCheck(domain: Domain, now: number): string {
  if (domain.nextCheckAt === null) return 'not scheduled'
  return domain.nextCheckAt <= now ? 'due now' : humanUntil(now, domain.nextCheckAt)
}
