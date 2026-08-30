import type { AuditRow } from '@deed/db'

/**
 * state-model §6 requires `check_completed` even when nothing changed — "we
 * looked and it held" is the freshness claim. At one sweep every 30 seconds that
 * is 2,880 identical rows a day, which buries the handful that matter. The
 * events stay; the rendering collapses them.
 */
export type LogEntry =
  /** Something happened: a transition, a claim, a rotation, a release. */
  | { readonly kind: 'moment'; readonly event: AuditRow }
  /** Nothing happened, n times running. */
  | {
      readonly kind: 'watch'
      readonly count: number
      readonly newest: AuditRow
      readonly oldest: AuditRow
      readonly status: string | null
    }

const isRoutine = (event: AuditRow): boolean => event.kind === 'check_completed'

/** Events arrive newest first and stay that way. */
export function toLogEntries(events: readonly AuditRow[]): LogEntry[] {
  const entries: LogEntry[] = []

  for (const event of events) {
    if (!isRoutine(event)) {
      entries.push({ kind: 'moment', event })
      continue
    }

    const last = entries.at(-1)
    if (last?.kind === 'watch' && last.status === event.to_status) {
      entries[entries.length - 1] = { ...last, count: last.count + 1, oldest: event }
      continue
    }

    entries.push({ kind: 'watch', count: 1, newest: event, oldest: event, status: event.to_status })
  }

  return entries
}

/**
 * Who did it, in words rather than in the enum's own vocabulary. `sweep` and
 * `system` are our internal distinction between a background pass and a check
 * triggered by someone opening the page; neither is the user's word for it.
 */
export function actorPhrase(actor: AuditRow['actor']): string {
  switch (actor) {
    case 'user':
      return 'you'
    case 'sweep':
      return 'automatically, in the background'
    case 'system':
      return 'automatically, when the page was opened'
  }
}

/** The tone a moment should carry, so a transition does not look like a no-op. */
export function toneOf(event: AuditRow): 'ok' | 'problem' | 'progress' | 'closed' | 'neutral' {
  if (event.kind === 'released') return 'closed'
  if (event.kind === 'claim_created' || event.kind === 'reclaimed') return 'neutral'
  if (event.kind === 'token_rotated') return 'progress'

  switch (event.to_status) {
    case null:
      return 'neutral'
    case 'verified':
      return 'ok'
    case 'mismatch':
    case 'absent':
    case 'zone_error':
    case 'degraded':
    case 'revoked':
      return 'problem'
    case 'propagating':
      return 'progress'
    case 'expired':
      return 'closed'
    default:
      return 'neutral'
  }
}
