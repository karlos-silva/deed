'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  CLAIM_TTL,
  DOMAINS_PER_ACCOUNT,
  SUPERSEDE_FLOOR,
  budgetWindowStart,
  checkNowDecision,
  type Domain,
  type DomainId,
  domainId as asDomainId,
  isExclusive,
  isTerminal,
  longest,
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
  setHidden,
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

const text = (form: FormData, key: string, fallback = ''): string => {
  const value = form.get(key)
  return typeof value === 'string' ? value : fallback
}

/**
 * What to say once the redirect lands. It travels in the query string because a
 * server action's only channel to the next render is the URL — but the client
 * strips it the moment it has been shown, so it cannot survive a reload the way
 * the old `?notice=` callout did.
 */
type Toast = {
  readonly message: string
  readonly tone?: 'ok' | 'danger'
  /** Offered when the action is genuinely reversible, and never when it is not. */
  readonly undo?: { readonly kind: 'restore' | 'remove'; readonly id: DomainId }
}

const toastQuery = (toast: Toast): string => {
  // A nonce, because the guard on the client has to defend against an effect
  // re-running — not against the same thing happening twice. Removing a domain,
  // undoing, and removing it again produces byte-identical copy, and keying on
  // content would swallow the second one.
  const params = new URLSearchParams({ toast: toast.message, tid: String(Date.now()) })
  if (toast.tone !== undefined) params.set('tone', toast.tone)
  if (toast.undo !== undefined) {
    params.set('undo', toast.undo.kind)
    params.set('undoId', toast.undo.id)
  }
  return params.toString()
}

const back: (id: DomainId, notice?: string, tone?: Toast['tone']) => never = (id, notice, tone) => {
  revalidatePath(`/domains/${id}`)
  redirect(
    notice === undefined
      ? `/domains/${id}`
      : `/domains/${id}?${toastQuery({ message: notice, ...(tone !== undefined && { tone }) })}`,
  )
}

/**
 * A failure that has nothing to do with the claim form. `?error=` is the
 * parameter that makes AddDomainDialog open itself, so routing an unrelated
 * refusal through it pops the claim form with "Not found" printed under an
 * empty field — which is what happened to anyone acting on a domain that had
 * been released in another tab.
 */
/**
 * The one refusal that belongs in `?error=`: it is about the claim form, so
 * reopening the form is the point. The attempt travels with it, or the user is
 * told a value is wrong and can no longer see it.
 */
const refuseClaim: (message: string, attempted: string) => never = (message, attempted) => {
  const params = new URLSearchParams({ error: message, domain: attempted })
  redirect(`/domains?${params.toString()}`)
}

const notFound: () => never = () =>
  toList({
    message: 'That domain is not here any more. It may have been released or removed.',
    tone: 'danger',
  })

const toList: (toast: Toast) => never = (toast) => {
  revalidatePath('/domains')
  redirect(`/domains?${toastQuery(toast)}`)
}

export async function claimDomain(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const raw = text(formData, 'domain', '')

  // Every refusal happens before a single lookup is attempted (prd §8).
  const parsed = parseClaim(raw)
  if (!parsed.ok) refuseClaim(refusalMessage(parsed.error, raw), raw)

  const existing = await listDomains(db, userId)
  // Live claims, not rows: closed ones are kept for their history and never
  // deleted, so counting them would let an account release its way into a
  // permanent lockout with no move left that frees a slot.
  const live = existing.filter((d) => !isTerminal(d.domain.ownership))
  if (live.length >= DOMAINS_PER_ACCOUNT) {
    refuseClaim(`One account holds at most ${DOMAINS_PER_ACCOUNT} live claims. Release one first.`, raw)
  }
  // A claim you can still act on, expired ones included — sending you to a dead
  // row instead of issuing a fresh token would be the wrong kind of helpful.
  const mine = live.find((d) => d.domain.name === parsed.value.name)
  if (mine !== undefined) back(mine.domain.id)

  const at = now()
  const stored = await createClaim(db, {
    ownerId: userId,
    name: parsed.value.name,
    isSandbox: parsed.value.isSandbox,
    ownership: { status: 'pending', token: mintToken(), claimedAt: at, expiresAt: plus(at, CLAIM_TTL) },
    now: at,
    nextCheckAt: at,
    // Held before and let go: the log opens with `reclaimed`, because this is a
    // second, separate history for the same name rather than a continuation.
    again: existing.some((d) => d.domain.name === parsed.value.name),
  })

  if (parsed.value.isSandbox) {
    await saveZone(db, stored.domain.id, userId, emptyZone(parsed.value.name))
  }

  revalidatePath('/domains')
  redirect(`/domains/${stored.domain.id}`)
}

export async function checkNow(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))

  const stored = await getDomain(db, id)
  // RLS already hid anyone else's domain; the refusal must not disclose whether it exists (S4).
  if (stored === null) notFound()

  // Without this, checking a released domain fires six live lookups, spends the
  // hourly budget, appends to a closed log and re-derives the record — so a dead
  // claim's badge visibly changes — and schedules it back into the sweep.
  if (isTerminal(stored.domain.ownership)) {
    back(id, 'This claim is closed. There is nothing left to check.')
  }

  const at = now()
  const decision = checkNowDecision({
    lastManualCheck: await lastManualCheck(db, id),
    spentThisHour: await countLookups(db, userId, budgetWindowStart(at)),
    now: at,
  })
  if (!decision.allowed) {
    back(
      id,
      decision.reason === 'cooldown'
        ? `Checked a moment ago. You can check again in ${decision.retryInSeconds}s.`
        : `That is ${decision.perHour} checks this hour. The background sweep keeps running.`,
    )
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

export async function rotateToken(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))
  const stored = await getDomain(db, id)
  if (stored === null) notFound()

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
    // Honoured for max(observed TTL, 24h) so a rotated token cannot outlive its claim (state-model §3).
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

export async function releaseDomain(formData: FormData): Promise<void> {
  const { db, userId } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))
  const stored = await getDomain(db, id)
  if (stored === null) notFound()

  const claim = stored.domain.ownership
  // Without this, a second submit appends a second `released` event to a claim
  // that is already closed, and the log stops being a record of what happened.
  if (isTerminal(claim)) back(id, 'This claim is already closed.')

  // The dialog asks for the name back before it will release a proved claim.
  // Checking it here too, because a dialog is a courtesy and not a guard: a bare
  // POST must not be able to give away a name someone has proved they own.
  if (isExclusive(claim) && text(formData, 'confirm', '') !== stored.domain.name) {
    back(id, 'Type the domain name to confirm releasing a proved claim.')
  }

  const at = now()
  const next: Domain = {
    ...stored.domain,
    ownership: { status: 'revoked', reason: 'released_by_owner' },
    supersession: null,
    nextCheckAt: null,
    lastChangedAt: at,
  }

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
    // Revoked and off the list in one transaction. Failing between the two would
    // leave it revoked and still sitting in the list, which is the state this
    // whole feature exists to remove.
    at,
  )
  if (!result.applied) back(id, 'Something else changed this domain first. Nothing was released.')

  void userId
  // No undo: the name went back to the pool as this committed, and somebody else
  // may already be proving it. A button promising otherwise would be a lie.
  toList({
    message: `${stored.domain.name} released. The name is free for anyone to claim again.`,
    tone: 'danger',
  })
}

/**
 * Takes a closed claim off the list, or puts it back. Reversible and destroys
 * nothing, so it asks for no confirmation; the guard that matters lives in
 * `set_hidden`, which refuses a claim that is still live.
 */
export async function removeFromList(formData: FormData): Promise<void> {
  await setListed(formData, false)
}

export async function restoreToList(formData: FormData): Promise<void> {
  await setListed(formData, true)
}

async function setListed(formData: FormData, listed: boolean): Promise<void> {
  const { db } = await requireSession()
  const id = asDomainId(text(formData, 'id', ''))
  const stored = await getDomain(db, id)
  if (stored === null) notFound()

  // Clicking twice is not an error, it is the same answer twice — but it has to
  // land on the tab the domain is actually in, and say so. Sending someone to
  // the list the row is missing from reads as data loss.
  if (listed === (stored.hiddenAt === null)) {
    toList({
      message: listed
        ? `${stored.domain.name} is already on your list.`
        : `${stored.domain.name} is already under Removed.`,
    })
  }

  if (!listed && !isTerminal(stored.domain.ownership)) {
    toList({ message: 'A live claim stays on the list. Release it first.', tone: 'danger' })
  }

  await setHidden(db, id, !listed, now())
  // Both directions are one click from being taken back, so both offer it.
  toList(
    listed
      ? {
          message: `${stored.domain.name} is back on your list.`,
          undo: { kind: 'remove', id },
        }
      : {
          message: `${stored.domain.name} removed from your list.`,
          undo: { kind: 'restore', id },
        },
  )
}

async function withZone(id: DomainId, edit: (zone: SandboxZone) => SandboxZone): Promise<void> {
  const { db, userId } = await requireSession()
  const stored = await getDomain(db, id)
  if (stored === null || !stored.domain.isSandbox) notFound()
  if (isTerminal(stored.domain.ownership)) {
    back(id, 'This claim is closed. Its zone can no longer prove anything.')
  }

  const loaded = (await loadZone(db, id)) as SandboxZone | null
  const zone = loaded ?? emptyZone(stored.domain.name)
  await saveZone(db, id, userId, edit(zone))
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

const observedTtl = (domain: Domain): number => {
  const record = domain.record
  if (record.status === 'verified' || record.status === 'propagating') return record.ttl.max
  return minutes(5) / 1_000
}
