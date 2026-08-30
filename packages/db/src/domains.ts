import {
  type AuditEvent,
  type Domain,
  type DomainId,
  type OwnershipState,
  type Timestamp,
  type UserId,
  at,
  domainId as asDomainId,
  userId as asUserId,
} from '@deed/core'
import type { Db } from './clients'
import {
  type AuditRow,
  type DomainRow,
  type LookupKind,
  type TransitionResult,
  asAuditRow,
  asDomainRow,
  asTransitionResult,
  toJson,
} from './types'

/**
 * The domain, plus the version it was read at. Every write carries the version
 * back so a sweep and a "check now" racing on one domain cannot both win
 * (state-model §4, invariant 8).
 */
export type StoredDomain = { readonly domain: Domain; readonly version: number }

const stamp = (iso: string): Timestamp => at(Date.parse(iso))
const iso = (t: Timestamp): string => new Date(t).toISOString()
const isoOrNull = (t: Timestamp | null): string | null => (t === null ? null : iso(t))

export function toDomain(row: DomainRow): StoredDomain {
  return {
    version: row.version,
    domain: {
      id: asDomainId(row.id),
      ownerId: asUserId(row.owner_id),
      name: row.name,
      isSandbox: row.is_sandbox,
      ownership: row.ownership,
      record: row.record,
      supersession: row.supersession,
      lastCheckedAt: row.last_checked_at === null ? null : stamp(row.last_checked_at),
      nextCheckAt: row.next_check_at === null ? null : stamp(row.next_check_at),
      lastChangedAt: stamp(row.last_changed_at),
      createdAt: stamp(row.created_at),
    },
  }
}

export async function listDomains(db: Db, owner: UserId): Promise<StoredDomain[]> {
  const { data, error } = await db
    .from('domains')
    .select('*')
    .eq('owner_id', owner)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data.map((row) => toDomain(asDomainRow(row)))
}

export async function getDomain(db: Db, id: DomainId): Promise<StoredDomain | null> {
  const { data, error } = await db.from('domains').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data === null ? null : toDomain(asDomainRow(data))
}

/** A live claim by anyone on this name — what makes verification exclusive (prd §8). */
export async function liveClaimOn(db: Db, name: string): Promise<{ ownerId: UserId } | null> {
  const { data, error } = await db
    .from('domains')
    .select('owner_id, ownership')
    .eq('name', name)
    .in('ownership->>status', ['verified', 'degraded'])
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data === null ? null : { ownerId: asUserId(data.owner_id) }
}

export type NewClaim = {
  readonly ownerId: UserId
  readonly name: string
  readonly isSandbox: boolean
  readonly ownership: OwnershipState
  readonly now: Timestamp
  readonly nextCheckAt: Timestamp
}

export async function createClaim(db: Db, claim: NewClaim): Promise<StoredDomain> {
  const { data, error } = await db
    .from('domains')
    .insert({
      owner_id: claim.ownerId,
      name: claim.name,
      is_sandbox: claim.isSandbox,
      ownership: toJson(claim.ownership),
      record: toJson({ status: 'unchecked' }),
      next_check_at: iso(claim.nextCheckAt),
      last_changed_at: iso(claim.now),
      created_at: iso(claim.now),
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  const stored = toDomain(asDomainRow(data))
  await writeEvent(db, {
    domain_id: stored.domain.id,
    owner_id: claim.ownerId,
    domain_name: claim.name,
    at: iso(claim.now),
    kind: 'claim_created',
    actor: 'user',
    level: null,
    from_status: null,
    to_status: 'pending',
    evidence: null,
  })
  return stored
}

/**
 * The one write path for a state transition. Takes the per-domain lock, commits
 * the state change and its audit events together, and revokes competing pending
 * claims when this one verifies (state-model §4, invariant 8; prd §8).
 */
export async function applyTransition(
  db: Db,
  read: StoredDomain,
  next: Domain,
  events: readonly AuditEvent[],
  now: Timestamp,
): Promise<TransitionResult> {
  const { data, error } = await db.rpc('apply_transition', {
    p_domain_id: next.id,
    p_version: read.version,
    p_now: iso(now),
    p_ownership: toJson(next.ownership),
    p_record: toJson(next.record),
    p_supersession: toJson(next.supersession),
    p_last_checked_at: isoOrNull(next.lastCheckedAt),
    p_next_check_at: isoOrNull(next.nextCheckAt),
    p_last_changed_at: iso(next.lastChangedAt),
    p_events: toJson(
      events.map((event) => ({
        at: iso(event.at),
        kind: event.kind,
        actor: event.actor,
        level: event.level ?? null,
        from: event.from ?? null,
        to: event.to ?? null,
        evidence: event.evidence ?? null,
      })),
    ),
  })
  if (error) throw new Error(error.message)
  return asTransitionResult(data)
}

export async function writeEvent(db: Db, event: Omit<AuditRow, 'id'>): Promise<void> {
  const { error } = await db
    .from('audit_events')
    .insert({ ...event, evidence: toJson(event.evidence) })
  if (error) throw new Error(error.message)
}

export type AuditPage = { readonly events: AuditRow[]; readonly nextCursor: number | null }

/**
 * Newest first and paginated: a domain checked every six hours for a month is a
 * page, not a download (S6).
 */
export async function listAudit(
  db: Db,
  id: DomainId,
  options: { before?: number; limit?: number } = {},
): Promise<AuditPage> {
  const limit = options.limit ?? 25
  let query = db
    .from('audit_events')
    .select('*')
    .eq('domain_id', id)
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)
  if (options.before !== undefined) query = query.lt('id', options.before)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const events = data.slice(0, limit).map(asAuditRow)
  const more = data.length > limit
  return { events, nextCursor: more ? (events.at(-1)?.id ?? null) : null }
}

/* ------------------------------- rate limits ------------------------------ */

export async function recordLookup(
  db: Db,
  owner: UserId,
  kind: LookupKind,
  domain: DomainId | null,
): Promise<void> {
  const { error } = await db.from('lookups').insert({ owner_id: owner, domain_id: domain, kind })
  if (error) throw new Error(error.message)
}

export async function countLookups(db: Db, owner: UserId, since: Timestamp): Promise<number> {
  const { count, error } = await db
    .from('lookups')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', owner)
    .gte('at', iso(since))
  if (error) throw new Error(error.message)
  return count ?? 0
}

/** When this domain was last checked on the user's own instruction. */
export async function lastManualCheck(db: Db, id: DomainId): Promise<Timestamp | null> {
  const { data, error } = await db
    .from('lookups')
    .select('at')
    .eq('domain_id', id)
    .eq('kind', 'check_now')
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data === null ? null : stamp(data.at)
}

/* ------------------------------- the sandbox ------------------------------ */

export async function loadZone(db: Db, id: DomainId): Promise<unknown | null> {
  const { data, error } = await db
    .from('sandbox_zones')
    .select('zone')
    .eq('domain_id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.zone ?? null
}

export async function saveZone(
  db: Db,
  id: DomainId,
  owner: UserId,
  zone: unknown,
): Promise<void> {
  const { error } = await db
    .from('sandbox_zones')
    .upsert({ domain_id: id, owner_id: owner, zone: toJson(zone) }, { onConflict: 'domain_id' })
  if (error) throw new Error(error.message)
}

/* -------------------------------- the sweep ------------------------------- */

export async function claimsDue(db: Db, now: Timestamp, limit = 25): Promise<StoredDomain[]> {
  const { data, error } = await db.rpc('claims_due', { p_now: iso(now), p_limit: limit })
  if (error) throw new Error(error.message)
  return data.map((row) => toDomain(asDomainRow(row)))
}

export async function recordSweep(
  db: Db,
  run: { due: number; checked: number; failed: number; detail?: string },
): Promise<void> {
  const { error } = await db.from('sweep_runs').insert({
    due: run.due,
    checked: run.checked,
    failed: run.failed,
    detail: run.detail ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function lastSweep(db: Db): Promise<Timestamp | null> {
  const { data, error } = await db
    .from('sweep_runs')
    .select('at')
    .order('at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data === null ? null : stamp(data.at)
}
