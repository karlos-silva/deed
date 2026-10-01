import type { OwnershipState, RecordState } from '@deed/core'

/**
 * The claim's state as a tone, for the things that carry it in colour rather
 * than in a word — the mark beside a domain's name in the list. Exported so
 * the badge and the mark cannot end up disagreeing about what yellow means.
 */
export type ClaimTone = 'ok' | 'progress' | 'problem' | 'closed'

export function claimTone(ownership: OwnershipState): ClaimTone {
  switch (ownership.status) {
    case 'pending':
      return 'progress'
    case 'verified':
      return 'ok'
    case 'degraded':
      return 'problem'
    case 'expired':
    case 'revoked':
      return 'closed'
  }
}

/** The claim's state in one word — the badge's text and the seal's legend. */
export function claimLabel(ownership: OwnershipState): string {
  switch (ownership.status) {
    case 'pending':
      return 'Pending'
    case 'verified':
      return 'Verified'
    case 'degraded':
      return 'At risk'
    case 'expired':
      return 'Expired'
    case 'revoked':
      return 'Released'
  }
}

const BADGE: Record<ClaimTone, string> = {
  progress: 'badge-pending',
  ok: 'badge-verified',
  problem: 'badge-failed',
  closed: 'badge-neutral',
}

export function ClaimBadge({ ownership }: { ownership: OwnershipState }) {
  return (
    <span className={`badge ${BADGE[claimTone(ownership)]}`}>
      {/* The pulse is what says "still checking" without spending a word on it.
          Only pending gets it: a dot pulsing on a final state would be a lie. */}
      {ownership.status === 'pending' && <span className="dot" aria-hidden="true" />}
      {claimLabel(ownership)}
    </span>
  )
}

export function RecordBadge({ record }: { record: RecordState }) {
  switch (record.status) {
    case 'unchecked':
      return <span className="badge badge-neutral">Not looked yet</span>
    case 'absent':
      return <span className="badge badge-pending">Not found</span>
    case 'propagating':
      return (
        <span className="badge badge-partial">
          {record.direction === 'arriving' ? 'Propagating' : 'Disappearing'}
        </span>
      )
    case 'mismatch':
      return <span className="badge badge-failed">Wrong value</span>
    case 'verified':
      return <span className="badge badge-verified">Verified</span>
    case 'zone_error':
      return <span className="badge badge-failed">Zone failing</span>
    case 'check_failed':
      return <span className="badge badge-neutral">Check failed</span>
  }
}
