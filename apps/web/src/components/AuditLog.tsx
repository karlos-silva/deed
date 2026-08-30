import type { AuditRow } from '@deed/db'
import { humanSince } from '@/lib/copy'

/**
 * "Show your work" as a surface rather than a claim (prd §3.4). Every entry is
 * something that actually happened, in the order it happened, including the
 * checks where nothing changed — because "we looked and it held" is the
 * freshness claim this product makes.
 */
export function AuditLog({ events, now }: { events: AuditRow[]; now: number }) {
  if (events.length === 0) {
    return <p className="t-body subtle">Nothing has happened yet. The first check is on its way.</p>
  }

  return (
    <div className="log">
      {events.map((event) => (
        <div className="log-entry" key={event.id}>
          <time dateTime={event.at} title={new Date(event.at).toISOString()}>
            {humanSince(Date.parse(event.at), now)}
          </time>
          <span className="what">{describe(event)}</span>
          <span className="who">{event.actor}</span>
        </div>
      ))}
    </div>
  )
}

function describe(event: AuditRow): string {
  switch (event.kind) {
    case 'claim_created':
      return 'Claim created and a token issued.'
    case 'token_rotated':
      return 'Token rotated. The previous value stops proving anything once its cache clears.'
    case 'released':
      return 'Released by you. The name is free for anyone to claim.'
    case 'reclaimed':
      return 'Claimed again, with a fresh token.'
    case 'check_completed':
      return event.to_status === null
        ? 'Checked.'
        : `Checked all three resolvers — ${readable(event.to_status)}.`
    case 'state_changed':
      return event.level === 'claim'
        ? `Ownership went from ${readable(event.from_status)} to ${readable(event.to_status)}.`
        : `The record went from ${readable(event.from_status)} to ${readable(event.to_status)}.`
  }
}

const readable = (status: string | null): string => {
  switch (status) {
    case null:
      return 'unknown'
    case 'unchecked':
      return 'not looked yet'
    case 'absent':
      return 'not found'
    case 'propagating':
      return 'propagating'
    case 'mismatch':
      return 'a wrong value'
    case 'verified':
      return 'verified'
    case 'zone_error':
      return 'their zone failing'
    case 'check_failed':
      return 'our lookup failing'
    case 'degraded':
      return 'at risk'
    case 'revoked':
      return 'released'
    default:
      return status
  }
}
