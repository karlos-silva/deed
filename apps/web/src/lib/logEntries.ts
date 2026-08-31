import type { AuditRow } from '@deed/db'

/*
 * The collapsing of consecutive identical checks used to live here. It moved
 * into SQL (migration 0007) because doing it in the component meant doing it
 * after the page limit: a domain checked every 30 seconds spent its whole first
 * page on routine, and the claim and the verification sat pages back behind
 * nothing. `audit_timeline` collapses first, and `packages/db/test` holds the
 * rules this file used to.
 */

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
