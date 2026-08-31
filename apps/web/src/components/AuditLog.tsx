import type { AuditRow, TimelineEntry } from '@deed/db'
import { humanSince } from '@/lib/copy'
import { actorPhrase, toneOf } from '@/lib/logEntries'

/**
 * Entries, not rows. The collapsing happens in SQL (migrations 0007 and 0008)
 * because doing it here meant doing it after the page limit, and because one
 * instant should be one line.
 *
 * Each entry is now one row high. The evidence used to sit on a disclosure of
 * its own beneath every entry, which doubled the height of the card to carry a
 * control most readers never open — so the line itself is the disclosure.
 */
export function AuditLog({ entries, now }: { entries: TimelineEntry[]; now: number }) {
  if (entries.length === 0) {
    return <p className="t-body muted">Nothing has happened yet. The first check is on its way.</p>
  }

  return (
    <ol className="log">
      {entries.map((entry) =>
        entry.kind === 'watch' ? (
          <Line
            key={`w${entry.id}`}
            tone="quiet"
            what={
              entry.runs === 1
                ? `Checked once — ${held(entry.status)}`
                : `Checked ${entry.runs} times — ${held(entry.status)}`
            }
            when={
              entry.runs === 1
                ? humanSince(Date.parse(entry.newestAt), now)
                : `${humanSince(Date.parse(entry.oldestAt), now)} – ${humanSince(Date.parse(entry.newestAt), now)}`
            }
            evidence={entry.evidence}
          />
        ) : (
          <Line
            key={entry.event.id}
            tone={toneOf(entry.event)}
            what={describe(entry.event)}
            by={actorPhrase(entry.event.actor)}
            when={humanSince(Date.parse(entry.event.at), now)}
            dateTime={entry.event.at}
            evidence={entry.event.evidence}
          />
        ),
      )}
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
  by?: string
  when: string
  dateTime?: string
  evidence: AuditRow['evidence']
}) {
  const answers = evidence?.answers ?? []

  const row = (
    <>
      <span className="rail" aria-hidden="true" />
      <span className="what">{what}</span>
      <span className="by">{by ?? ''}</span>
      <span className="when">
        {dateTime === undefined ? when : <time dateTime={dateTime}>{when}</time>}
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

/**
 * What a run of identical checks is evidence of. A bare "nothing changed" makes
 * the reader supply the subject themselves, and the one they supply is usually
 * the wrong one.
 */
const held = (status: string | null): string => {
  switch (status) {
    case 'verified':
      return 'still verified'
    case 'absent':
      return 'still not found'
    case 'mismatch':
      return 'still the wrong value'
    case 'propagating':
      return 'still spreading'
    case 'zone_error':
      return 'their zone still failing'
    case 'check_failed':
      return 'our lookup still failing'
    case 'degraded':
      return 'still at risk'
    case null:
    default:
      return 'nothing changed'
  }
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
