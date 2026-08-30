import type { AuditRow } from '@deed/db'
import { humanSince } from '@/lib/copy'
import { actorPhrase, toLogEntries, toneOf } from '@/lib/logEntries'

export function AuditLog({ events, now }: { events: AuditRow[]; now: number }) {
  if (events.length === 0) {
    return <p className="t-body muted">Nothing has happened yet. The first check is on its way.</p>
  }

  return (
    <ol className="log">
      {toLogEntries(events).map((entry) =>
        entry.kind === 'watch' ? (
          <li className="log-watch" key={`w${entry.newest.id}`}>
            <span className="log-tick" aria-hidden="true" />
            <span className="what">
              {entry.count === 1
                ? 'Checked, nothing changed'
                : `Checked ${entry.count} times, nothing changed`}
            </span>
            <span className="when">
              {entry.count === 1
                ? humanSince(Date.parse(entry.newest.at), now)
                : `${humanSince(Date.parse(entry.oldest.at), now)} – ${humanSince(Date.parse(entry.newest.at), now)}`}
            </span>
          </li>
        ) : (
          <li className="log-moment" data-state={toneOf(entry.event)} key={entry.event.id}>
            <span className="rail" aria-hidden="true" />
            <div className="body">
              <p className="what">{describe(entry.event)}</p>
              <p className="meta">
                <time dateTime={entry.event.at}>{humanSince(Date.parse(entry.event.at), now)}</time>
                <span aria-hidden="true"> · </span>
                {actorPhrase(entry.event.actor)}
              </p>
              {entry.event.evidence !== null && <Evidence event={entry.event} />}
            </div>
          </li>
        ),
      )}
    </ol>
  )
}

/** A verdict the user can audit is a verdict they can trust (prd §3.4). */
function Evidence({ event }: { event: AuditRow }) {
  const answers = event.evidence?.answers ?? []
  if (answers.length === 0) return null

  return (
    <details className="log-evidence">
      <summary>What each resolver answered</summary>
      <ul>
        {answers.map((answer) => (
          <li key={answer.resolver}>
            <span className="who">{answer.resolver}</span>
            <span className="said">
              {answer.outcome === 'answered'
                ? answer.values.join(' , ') || 'no values'
                : answer.outcome === 'zone_error' || answer.outcome === 'check_failed'
                  ? `${answer.outcome.replace('_', ' ')}: ${answer.detail}`
                  : answer.outcome}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function describe(event: AuditRow): string {
  switch (event.kind) {
    case 'claim_created':
      return 'You claimed this domain, and a token was issued.'
    case 'token_rotated':
      return 'Token rotated. The previous value stops proving anything once its cache clears.'
    case 'released':
      return 'You released this domain. The name is free for anyone to claim.'
    case 'reclaimed':
      return 'Claimed again, with a fresh token.'
    case 'check_completed':
      return `Checked — ${readable(event.to_status)}.`
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
      return 'not looked at yet'
    case 'absent':
      return 'not found'
    case 'mismatch':
      return 'a wrong value'
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
