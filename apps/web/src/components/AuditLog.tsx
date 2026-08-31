import type { AuditRow, TimelineEntry } from '@deed/db'
import { humanSince } from '@/lib/copy'
import { actorPhrase, toneOf } from '@/lib/logEntries'

/**
 * Entries, not rows. The collapsing happens in SQL (migration 0007) because
 * doing it here meant doing it after the page limit — and a domain checked every
 * 30 seconds spent its entire first page on routine, so the claim and the
 * verification sat pages back behind nothing.
 */
export function AuditLog({ entries, now }: { entries: TimelineEntry[]; now: number }) {
  if (entries.length === 0) {
    return <p className="t-body muted">Nothing has happened yet. The first check is on its way.</p>
  }

  return (
    <ol className="log">
      {entries.map((entry) =>
        entry.kind === 'watch' ? (
          <li className="log-watch" key={`w${entry.id}`}>
            <span className="log-tick" aria-hidden="true" />
            <span className="what">
              {entry.runs === 1
                ? `Checked once — ${held(entry.status)}`
                : `Checked ${entry.runs} times — ${held(entry.status)}`}
            </span>
            <span className="when">
              {entry.runs === 1
                ? humanSince(Date.parse(entry.newestAt), now)
                : `${humanSince(Date.parse(entry.oldestAt), now)} – ${humanSince(Date.parse(entry.newestAt), now)}`}
            </span>
            <Evidence evidence={entry.evidence} summary={entry.runs === 1 ? "What it saw" : "What the last of them saw"} />
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
              <Evidence
                evidence={entry.event.evidence}
                summary="What each resolver answered"
              />
            </div>
          </li>
        ),
      )}
    </ol>
  )
}

/** A verdict the user can audit is a verdict they can trust (prd §3.4). */
function Evidence({
  evidence,
  summary,
}: {
  evidence: AuditRow['evidence']
  summary: string
}) {
  const answers = evidence?.answers ?? []
  if (answers.length === 0) return null

  return (
    <details className="log-evidence">
      <summary>{summary}</summary>
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

/**
 * What a run of identical checks is evidence of. A bare "nothing changed" makes
 * the reader supply the subject themselves, and the one they supply is usually
 * the wrong one — the whole complaint about this row was that it read as if the
 * interesting events had gone missing. Naming the status that held turns the
 * line from an absence into a statement, which is what Sentry does when it
 * promotes a repeated event's count next to the state it is stuck in.
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
    // A run with no recorded status has nothing to name, so it keeps the plain
    // wording rather than inventing a subject.
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
