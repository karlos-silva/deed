import { type Duration, type ResolverId, type Timestamp, seconds } from '@deed/core'

export type ZoneRecordType = 'TXT' | 'CNAME' | 'A' | 'NS'

export type ZoneRecord = {
  readonly id: string
  /** A label relative to the zone: `@` for the apex, `*` for a wildcard. */
  readonly host: string
  readonly type: ZoneRecordType
  readonly value: string
  readonly ttl: number
  readonly createdAt: Timestamp
  /** Kept after deletion: caches keep serving a deleted record until the delay passes. */
  readonly deletedAt: Timestamp | null
}

/** The first three are the zone's own failure; `timeout` and `throttled` are ours. */
export type ZoneOutage = 'servfail' | 'refused' | 'dnssec' | 'timeout' | 'throttled' | null

export type SandboxZone = {
  readonly name: string
  readonly records: readonly ZoneRecord[]
  readonly outage: ZoneOutage
}

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

/** A delete plus an add: the old value keeps being served until each cache clears. */
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

export function visibleTo(zone: SandboxZone, resolver: ResolverId, now: Timestamp): ZoneRecord[] {
  const delay = SANDBOX_DELAY[resolver]
  return zone.records.filter((record) => {
    if (now < record.createdAt + delay) return false
    return record.deletedAt === null || now < record.deletedAt + delay
  })
}

/** An explicit record beats a wildcard, and a wildcard answers only for names that do not exist. */
export function answersFor(records: readonly ZoneRecord[], label: string): ZoneRecord[] {
  const explicit = records.filter((r) => r.host === label)
  if (explicit.length > 0) return explicit
  if (label === '*' || label === '@') return []
  return records.filter((r) => r.host === '*')
}

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
