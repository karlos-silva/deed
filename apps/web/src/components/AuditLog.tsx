import type { AuditRow } from '@deed/db'
import { humanSince } from '@/lib/copy'
import { actorPhrase, toneOf } from '@/lib/logEntries'

/**
 * Moments, not rows. The filtering happens in SQL (migrations 0007-0009)
 * because doing it here meant doing it after the page limit, and because a
 * check that found nothing new is not something that happened. Whether the
 * sweep is still running is the record panel's "Last checked" to answer.
 *
 * Each entry is one row high. The evidence used to sit on a disclosure of its
 * own beneath every entry, which doubled the height of the card to carry a
 * control most readers never open — so the line itself is the disclosure.
 */
export function AuditLog({ entries, now }: { entries: AuditRow[]; now: number }) {
  if (entries.length === 0) {
    return <p className="t-body muted">Nothing has happened yet. The first check is on its way.</p>
  }

  return (
    <ol className="log">
      {entries.map((event) => (
        <Line
          key={event.id}
          tone={toneOf(event)}
          what={describe(event)}
          by={actorPhrase(event.actor)}
          when={humanSince(Date.parse(event.at), now)}
          dateTime={event.at}
          evidence={event.evidence}
        />
      ))}
    </ol>
  )
}

/**
 * One row: rail, what happened, who, when. Where there is evidence the whole row
 * is the summary of a `<details>` — a verdict the user can audit is a verdict
 * they can trust (prd §3.4), but it does not have to spend a line saying so.
 */
function Line({
  tone,
  what,
  by,
  when,
  dateTime,
  evidence,
}: {
  tone: string
  what: string
  by: string
  when: string
  dateTime: string
  evidence: AuditRow['evidence']
}) {
  const answers = evidence?.answers ?? []

  const row = (
    <>
      <span className="rail" aria-hidden="true" />
      <span className="what">{what}</span>
      <span className="by">{by}</span>
      <span className="when">
        <time dateTime={dateTime}>{when}</time>
      </span>
    </>
  )

  if (answers.length === 0) {
    return (
      <li className="log-line" data-state={tone}>
        {row}
      </li>
    )
  }

  return (
    <li className="log-line has-evidence" data-state={tone}>
      <details>
        <summary>{row}</summary>
        <ul className="answers">
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
    </li>
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
    // Never reaches the log — `audit_timeline` keeps routine checks out of it
    // (0009). The case stays because the union is exhaustive and `listAudit`
    // still returns every one of them.
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
