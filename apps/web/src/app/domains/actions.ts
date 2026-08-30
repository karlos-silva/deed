'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  CHECK_NOW_COOLDOWN,
  CLAIM_TTL,
  DOMAINS_PER_ACCOUNT,
  SUPERSEDE_FLOOR,
  USER_LOOKUP_BUDGET,
  type Domain,
  type DomainId,
  domainId as asDomainId,
  hours,
  longest,
  minus,
  minutes,
  parseClaim,
  plus,
  seconds,
} from '@deed/core'
import {
  applyTransition,
  countLookups,
  createClaim,
  getDomain,
  lastManualCheck,
  listDomains,
  loadZone,
  recordLookup,
  saveZone,
} from '@deed/db'
import {
  type SandboxZone,
  addRecord,
  deleteRecord,
  emptyZone,
  setOutage,
  type ZoneOutage,
  type ZoneRecordType,
} from '@deed/dns'
import { requireSession } from '@/lib/session'
import { mintToken } from '@/lib/token'
import { now, runCheck } from '@/lib/verification'
import { refusalMessage } from '@/lib/refusal'

/** `FormData.get` yields `string | File | null`; only the first is ever a field here. */
const text = (form: FormData, key: string, fallback = ''): string => {
  const value = form.get(key)
  return typeof value === 'string' ? value : fallback
}

const back: (id: DomainId, notice?: string) => never = (id, notice) => {
  revalidatePath(`/domains/${id}`)
  redirect(notice === undefined ? `/domains/${id}` : `/domains/${id}?notice=${encodeURIComponent(notice)}`)
}

/* --------------------------------------------------------------- claim --- */

export async function claimDomain(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const raw = text(formData, 'domain', '')

  // Every refusal happens before a single lookup is attempted (prd §8).
  const parsed = parseClaim(raw)
  if (!parsed.ok) redirect(`/domains?error=${encodeURIComponent(refusalMessage(parsed.error, raw))}`)

  const existing = await listDomains(db, userId)
  if (existing.length >= DOMAINS_PER_ACCOUNT) {
    redirect(`/domains?error=${encodeURIComponent(`One account holds at most ${DOMAINS_PER_ACCOUNT} domains.`)}`)
  }
  const mine = existing.find(
    (d) => d.domain.name === parsed.value.name && d.domain.ownership.status !== 'revoked',
  )
  if (mine !== undefined) back(mine.domain.id)

  const at = now()
  const stored = await createClaim(db, {
    ownerId: userId,
    name: parsed.value.name,
    isSandbox: parsed.value.isSandbox,
    ownership: { status: 'pending', token: mintToken(), claimedAt: at, expiresAt: plus(at, CLAIM_TTL) },
    now: at,
    // The first check is due immediately; the cadence takes over after it.
    nextCheckAt: at,
  })

  if (parsed.value.isSandbox) {
    await saveZone(db, stored.domain.id, userId, emptyZone(parsed.value.name))
  }

  revalidatePath('/domains')
  redirect(`/domains/${stored.domain.id}`)
}

/* ----------------------------------------------------------- check now --- */

export async function checkNow(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))

  const stored = await getDomain(db, id)
  // RLS already hid anyone else's domain. Saying no more than this is the
  // point: the refusal must not disclose whether the domain exists (S4).
  if (stored === null) redirect('/domains?error=Not+found')

  const at = now()
  const last = await lastManualCheck(db, id)
  if (last !== null && at - last < CHECK_NOW_COOLDOWN) {
    const remaining = Math.ceil((CHECK_NOW_COOLDOWN - (at - last)) / 1_000)
    back(id, `Checked a moment ago. You can check again in ${remaining}s.`)
  }

  const spent = await countLookups(db, userId, minus(at, hours(1)))
  if (spent >= USER_LOOKUP_BUDGET) {
    back(id, `That is ${USER_LOOKUP_BUDGET} checks this hour. The background sweep keeps running.`)
  }

  await recordLookup(db, userId, 'check_now', id)
  const outcome = await runCheck(db, stored, 'user', at)
  back(
    id,
    outcome.status === 'raced'
      ? 'A background check landed at the same moment; you are seeing its result.'
      : undefined,
  )
}

/* ------------------------------------------------------------ rotation --- */

export async function rotateToken(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))
  const stored = await getDomain(db, id)
  if (stored === null) redirect('/domains?error=Not+found')

  const claim = stored.domain.ownership
  if (claim.status !== 'pending' && claim.status !== 'verified' && claim.status !== 'degraded') {
    back(id, 'A claim that is no longer live has no token to rotate.')
  }

  const at = now()
  const observed = observedTtl(stored.domain)
  const token = mintToken()
  const next: Domain = {
    ...stored.domain,
    ownership:
      claim.status === 'pending'
        ? { ...claim, token }
        : claim.status === 'verified'
          ? { ...claim, token }
          : { ...claim, token },
    // Honoured for max(observed TTL, 24h), then it becomes an ordinary unknown
    // value — a token that outlives its claim is what rotation exists to
    // prevent (state-model §3).
    supersession: {
      previousToken: claim.token,
      rotatedAt: at,
      honourUntil: plus(at, longest(seconds(observed), SUPERSEDE_FLOOR)),
    },
    nextCheckAt: plus(at, seconds(30)),
    lastChangedAt: at,
  }

  const result = await applyTransition(
    db,
    stored,
    next,
    [{ domainId: id, at, kind: 'token_rotated', actor: 'user', from: 'token', to: 'token' }],
    at,
  )
  if (!result.applied) back(id, 'Something else changed this domain first. Nothing was rotated.')

  await recordLookup(db, userId, 'check_now', id)
  back(id, 'A new token is issued. The previous one stops being accepted once its cache clears.')
}

/* ------------------------------------------------------------- release --- */

export async function releaseDomain(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))
  const stored = await getDomain(db, id)
  if (stored === null) redirect('/domains?error=Not+found')

  const at = now()
  const next: Domain = {
    ...stored.domain,
    ownership: { status: 'revoked', reason: 'released_by_owner' },
    supersession: null,
    nextCheckAt: null,
    lastChangedAt: at,
  }

  // The history survives: the log records what *they* did and saw, and taking
  // it away at release would punish exactly the person trying to understand
  // what happened (prd §10).
  const result = await applyTransition(
    db,
    stored,
    next,
    [
      { domainId: id, at, kind: 'released', actor: 'user' },
      {
        domainId: id,
        at,
        kind: 'state_changed',
        actor: 'user',
        level: 'claim',
        from: stored.domain.ownership.status,
        to: 'revoked',
      },
    ],
    at,
  )
  if (!result.applied) back(id, 'Something else changed this domain first. Nothing was released.')

  void userId
  revalidatePath('/domains')
  back(id, 'Released. The name is free for anyone to claim again.')
}

/* -------------------------------------------------------- the sandbox --- */

async function withZone(id: DomainId, edit: (zone: SandboxZone) => SandboxZone): Promise<void> {
  const { db, userId } = await requireSession()
  const stored = await getDomain(db, id)
  if (stored === null || !stored.domain.isSandbox) redirect('/domains?error=Not+found')

  const loaded = (await loadZone(db, id)) as SandboxZone | null
  const zone = loaded ?? emptyZone(stored.domain.name)
  await saveZone(db, id, userId, edit(zone))

  // The zone changed, so the verdict may have too. Checking immediately is what
  // makes the sandbox an instrument rather than a screenshot — and the check
  // writes its own audit event, through the one path allowed to.
  await runCheck(db, stored, 'user', now())
}

export async function addZoneRecord(formData: FormData): Promise<void> {
  const id = asDomainId(text(formData, 'id', ''))
  const host = text(formData, 'host', '').trim()
  const value = text(formData, 'value', '')
  const type = text(formData, 'type', 'TXT') as ZoneRecordType
  const ttl = Number(text(formData, 'ttl', '300'))
  if (host === '') back(id, 'A record needs a host.')

  const at = now()
  await withZone(id, (zone) =>
    addRecord(zone, { id: `${at}-${Math.round(at % 100000)}`, host, value, type, ttl }, at),
  )
  back(id)
}

export async function removeZoneRecord(formData: FormData): Promise<void> {
  const id = asDomainId(text(formData, 'id', ''))
  const recordId = text(formData, 'record', '')
  await withZone(id, (zone) => deleteRecord(zone, recordId, now()))
  back(id)
}

export async function setZoneOutage(formData: FormData): Promise<void> {
  const id = asDomainId(text(formData, 'id', ''))
  const raw = text(formData, 'outage', '')
  const outage = (raw === '' ? null : raw) as ZoneOutage
  await withZone(id, (zone) => setOutage(zone, outage))
  back(id)
}

/* ---------------------------------------------------------------------- */

const observedTtl = (domain: Domain): number => {
  const record = domain.record
  if (record.status === 'verified' || record.status === 'propagating') return record.ttl.max
  return minutes(5) / 1_000
}
