import { type Duration, type ResolverId, type Timestamp, seconds } from '@deed/core'

/**
 * The simulated zone (D2). A visitor with no domain to hand edits this
 * directly and drives the same verification engine — it is the visitor's
 * primary instrument, not a hidden debug tool.
 *
 * Every edit is a pure function returning a new zone, so the whole thing
 * persists as one JSON column and replays in a test with no clock.
 */

/**
 * `A` exists so a host can *exist* while holding no TXT — the difference
 * between `nxdomain` and `nodata`, which warrant different hints (state-model §3).
 */
export type ZoneRecordType = 'TXT' | 'CNAME' | 'A'

export type ZoneRecord = {
  readonly id: string
  /** A label relative to the zone: `@` for the apex, `*` for a wildcard. */
  readonly host: string
  readonly type: ZoneRecordType
  readonly value: string
  readonly ttl: number
  readonly createdAt: Timestamp
  /** Kept after deletion: resolvers serve a deleted record until their cache clears. */
  readonly deletedAt: Timestamp | null
}

/**
 * A zone can also simply fail. The first three are the user's problem, the last
 * two are ours — the distinction the whole product turns on (state-model §3).
 */
export type ZoneOutage = 'servfail' | 'refused' | 'dnssec' | 'timeout' | 'throttled' | null

export type SandboxZone = {
  /** The claimed name this zone is rooted at, e.g. `acme.test`. */
  readonly name: string
  readonly records: readonly ZoneRecord[]
  readonly outage: ZoneOutage
}

/**
 * Each resolver adopts a change after its own delay, exactly as the prototype
 * did. This is what makes `propagating`, `receding` and a stale cache reachable
 * on demand instead of by hand-breaking real DNS.
 */
export const SANDBOX_DELAY: Record<ResolverId, Duration> = {
  cloudflare: seconds(25),
  google: seconds(55),
  adguard: seconds(95),
}

export const emptyZone = (name: string): SandboxZone => ({ name, records: [], outage: null })

export type NewRecord = {
  readonly id: string
  readonly host: string
  readonly type?: ZoneRecordType
  readonly value: string
  readonly ttl?: number
}

export const addRecord = (zone: SandboxZone, record: NewRecord, now: Timestamp): SandboxZone => ({
  ...zone,
  records: [
    ...zone.records,
    {
      id: record.id,
      host: normaliseHost(record.host, zone.name),
      type: record.type ?? 'TXT',
      value: record.value,
      ttl: record.ttl ?? 300,
      createdAt: now,
      deletedAt: null,
    },
  ],
})

export const deleteRecord = (zone: SandboxZone, id: string, now: Timestamp): SandboxZone => ({
  ...zone,
  records: zone.records.map((r) => (r.id === id && r.deletedAt === null ? { ...r, deletedAt: now } : r)),
})

/**
 * An edit is a delete plus an add, so the old value keeps being served until
 * each cache clears — which is exactly what a real edit looks like from outside.
 */
export const editRecord = (
  zone: SandboxZone,
  id: string,
  value: string,
  newId: string,
  now: Timestamp,
): SandboxZone => {
  const existing = zone.records.find((r) => r.id === id && r.deletedAt === null)
  if (existing === undefined) return zone
  return addRecord(deleteRecord(zone, id, now), { ...existing, id: newId, value }, now)
}

export const setOutage = (zone: SandboxZone, outage: ZoneOutage): SandboxZone => ({ ...zone, outage })

/** Records this resolver can see right now, given its own propagation delay. */
export function visibleTo(zone: SandboxZone, resolver: ResolverId, now: Timestamp): ZoneRecord[] {
  const delay = SANDBOX_DELAY[resolver]
  return zone.records.filter((record) => {
    if (now < record.createdAt + delay) return false
    return record.deletedAt === null || now < record.deletedAt + delay
  })
}

/**
 * Which records answer for `host`. DNS gives an explicit record precedence over
 * a wildcard, and a wildcard answers only for names that do not exist — the
 * rule that lets a legitimate `* IN TXT "v=spf1 -all"` coexist with a real
 * challenge record (state-model §3).
 */
export function answersFor(records: readonly ZoneRecord[], label: string): ZoneRecord[] {
  const explicit = records.filter((r) => r.host === label)
  if (explicit.length > 0) return explicit
  if (label === '*' || label === '@') return []
  return records.filter((r) => r.host === '*')
}

/** `_deed-challenge.acme.test` inside zone `acme.test` is the label `_deed-challenge`. */
export function labelOf(host: string, zoneName: string): string | null {
  const name = host.replace(/\.$/, '').toLowerCase()
  const zone = zoneName.replace(/\.$/, '').toLowerCase()
  if (name === zone) return '@'
  if (name.endsWith(`.${zone}`)) return name.slice(0, name.length - zone.length - 1)
  return null
}

const normaliseHost = (host: string, zoneName: string): string => {
  const trimmed = host.replace(/\.$/, '').toLowerCase()
  if (trimmed === '' || trimmed === '@') return '@'
  return labelOf(trimmed, zoneName) ?? trimmed
}
