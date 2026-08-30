import type { OwnershipState, RecordState } from '@deed/core'

export function ClaimBadge({ ownership }: { ownership: OwnershipState }) {
  switch (ownership.status) {
    case 'pending':
      return <span className="badge badge-pending">Pending</span>
    case 'verified':
      return <span className="badge badge-verified">Verified</span>
    case 'degraded':
      return <span className="badge badge-failed">At risk</span>
    case 'expired':
      return <span className="badge badge-neutral">Expired</span>
    case 'revoked':
      return <span className="badge badge-neutral">Released</span>
  }
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
