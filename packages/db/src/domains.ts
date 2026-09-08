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

/** The domain and the version it was read at; writes carry it back (state-model §4, invariant 8). */
export type StoredDomain = {
  readonly domain: Domain
  readonly version: number
  /**
   * When the owner took this closed claim off their list, or null while it is
   * listed. Deliberately not part of `Domain`: it changes nothing the reducer
   * reasons about, and putting it there would push a view preference through
   * every transition, invariant and fixture in `packages/core`.
   */
  readonly hiddenAt: Timestamp | null
}

const stamp = (iso: string): Timestamp => at(Date.parse(iso))
const iso = (t: Timestamp): string => new Date(t).toISOString()
const isoOrNull = (t: Timestamp | null): string | null => (t === null ? null : iso(t))

export function toDomain(row: DomainRow): StoredDomain {
  return {
    version: row.version,
    hiddenAt: row.hidden_at === null ? null : stamp(row.hidden_at),
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
  /** This owner has held this name before, so the log opens with `reclaimed`. */
  readonly again: boolean
}

/** Goes through an RPC because `audit_events` has no INSERT policy: the log is not client-writable. */
export async function createClaim(db: Db, claim: NewClaim): Promise<StoredDomain> {
  const { data, error } = await db.rpc('create_claim', {
    p_name: claim.name,
    p_is_sandbox: claim.isSandbox,
    p_ownership: toJson(claim.ownership),
    p_now: iso(claim.now),
    p_next_check_at: iso(claim.nextCheckAt),
    p_again: claim.again,
  })
  if (error) throw new Error(error.message)
  return toDomain(asDomainRow(data))
}

/**
 * Moves a closed claim between the list and Removed. Not a transition: it writes
 * no audit event and does not touch `version`, because it changes nothing the
 * model reasons about (see migration 0006).
 */
export async function setHidden(
  db: Db,
  id: DomainId,
  hidden: boolean,
  now: Timestamp,
): Promise<StoredDomain> {
  const { data, error } = await db.rpc('set_hidden', {
    p_domain_id: id,
    p_hidden: hidden,
    p_now: iso(now),
  })
  if (error) throw new Error(error.message)
  return toDomain(asDomainRow(data))
}

/** The one write path for a state transition (state-model §4, invariant 8; prd §8). */
export async function applyTransition(
  db: Db,
  read: StoredDomain,
  next: Domain,
  events: readonly AuditEvent[],
  now: Timestamp,
  /**
   * Set to take the row off the owner's list as part of this transition. Null
   * leaves it as it is — releasing has to revoke and unlist atomically, because
   * failing between the two leaves exactly the state the feature removes.
   */
  hiddenAt: Timestamp | null = null,
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
    p_hidden_at: isoOrNull(hiddenAt),
  })
  if (error) throw new Error(error.message)
  return asTransitionResult(data)
}

// Keyed on `(at, id)`, not `id` alone: a backfilled event pairs an old `at` with
// a new `id`, and a page would then skip or repeat rows around it.
export type AuditCursor = { readonly at: string; readonly id: number }
export type AuditPage = { readonly events: AuditRow[]; readonly nextCursor: AuditCursor | null }

/**
 * The log as moments rather than rows. `audit_timeline` decides what earns a
 * line before the page limit is applied — routine checks earn none, so a domain
 * swept every 30 seconds cannot push the claim and the verification pages back
 * behind nothing (0007, 0009).
 */
export type Timeline = {
  readonly entries: AuditRow[]
  readonly nextCursor: AuditCursor | null
}

export async function listTimeline(
  db: Db,
  id: DomainId,
  options: { before?: AuditCursor; limit?: number } = {},
): Promise<Timeline> {
  const limit = options.limit ?? 20
  const before = options.before
  const { data, error } = await db.rpc('audit_timeline', {
    p_domain_id: id,
    // One more than asked, so the presence of a next page is a fact rather than
    // a guess from a full page.
    p_limit: limit + 1,
    p_before: before?.at ?? null,
    p_before_id: before?.id ?? null,
  })
  if (error) throw new Error(error.message)

  const rows = data.slice(0, limit)
  const entries = rows.map((row) =>
    // The function returns the fields a moment is rendered from; owner and name
    // are on the row it came from and nothing on screen reads them.
    asAuditRow({
      id: row.id,
      domain_id: id,
      owner_id: '',
      domain_name: '',
      at: row.at,
      kind: row.kind,
      actor: row.actor,
      level: row.level,
      from_status: row.from_status,
      to_status: row.to_status,
      evidence: row.evidence,
    }),
  )

  const last = entries.at(-1)
  return {
    entries,
    nextCursor: data.length > limit && last !== undefined ? { at: last.at, id: last.id } : null,
  }
}

export async function listAudit(
  db: Db,
  id: DomainId,
  options: { before?: AuditCursor; limit?: number } = {},
): Promise<AuditPage> {
  const limit = options.limit ?? 25
  let query = db
    .from('audit_events')
    .select('*')
    .eq('domain_id', id)
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  const before = options.before
  if (before !== undefined) {
    query = query.or(`at.lt.${before.at},and(at.eq.${before.at},id.lt.${before.id})`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const events = data.slice(0, limit).map(asAuditRow)
  const last = events.at(-1)
  return {
    events,
    nextCursor: data.length > limit && last !== undefined ? { at: last.at, id: last.id } : null,
  }
}

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

export async function loadZone(db: Db, id: DomainId): Promise<unknown> {
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
