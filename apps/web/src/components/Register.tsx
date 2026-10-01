import Link from 'next/link'
import { type OwnershipState, isExclusive, isTerminal } from '@deed/core'
import { humanSince } from '@/lib/copy'
import { ClaimBadge, type ClaimTone, claimTone } from '@/components/StatusBadge'
import { DomainMark } from '@/components/DomainMark'
import { RowActions } from '@/components/RowActions'

/** One line of the register: what the list needs to know about a claim, and no more. */
export type RegisterEntry = {
  id: string
  name: string
  ownership: OwnershipState
  isSandbox: boolean
  lastCheckedAt: number | null
  createdAt: number
}

type Action = (formData: FormData) => void | Promise<void>

/**
 * The domains list, shared by the page and the design gallery so the gallery
 * cannot drift from what a signed-in owner actually sees.
 */
export function RegisterTable({
  entries,
  now,
  release,
  remove,
}: {
  entries: RegisterEntry[]
  now: number
  release: Action
  remove: Action
}) {
  return (
    <div className="register-wrap">
      <table className="register">
        <thead>
          <tr>
            <th scope="col">Domain</th>
            <th scope="col">Status</th>
            <th scope="col" className="when">
              Last checked
            </th>
            <th scope="col" className="when created">
              Created
            </th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <Row key={entry.id} entry={entry} now={now} release={release} remove={remove} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({
  entry,
  now,
  release,
  remove,
}: {
  entry: RegisterEntry
  now: number
  release: Action
  remove: Action
}) {
  const closed = isTerminal(entry.ownership)
  const tone = claimTone(entry.ownership)

  return (
    <tr data-state={tone}>
      <th scope="row">
        <Link href={`/domains/${entry.id}`}>
          {/* The row's state, in colour, where the eye starts: yellow while a
              claim is pending, green once it is proved, red when it is at risk. */}
          <span className="row-mark">
            <DomainMark />
          </span>
          <span className="name-line">
            <span className="name">{entry.name}</span>
            {entry.isSandbox && <span className="badge badge-info">simulated</span>}
          </span>
          <span className="go" aria-hidden="true">
            →
          </span>
        </Link>
      </th>
      <td>
        <ClaimBadge ownership={entry.ownership} />
      </td>
      <td className="when">
        {entry.lastCheckedAt === null ? '—' : humanSince(entry.lastCheckedAt, now)}
      </td>
      <td className="when created">{humanSince(entry.createdAt, now)}</td>
      <td className="row-actions">
        {/* Only a closed claim leaves the list; a live one is released first. */}
        <RowActions
          domainId={entry.id}
          name={entry.name}
          state={closed ? 'closed' : 'live'}
          requireTyping={isExclusive(entry.ownership)}
          release={release}
          remove={remove}
        />
      </td>
    </tr>
  )
}

const TALLY: { tone: ClaimTone; one: string; many: string }[] = [
  { tone: 'ok', one: 'proven', many: 'proven' },
  { tone: 'progress', one: 'pending', many: 'pending' },
  { tone: 'problem', one: 'at risk', many: 'at risk' },
  { tone: 'closed', one: 'closed', many: 'closed' },
]

/** The register at a glance: how many claims stand where. Empty groups say nothing. */
export function Tally({ entries }: { entries: RegisterEntry[] }) {
  const counts = TALLY.map((group) => ({
    ...group,
    count: entries.filter((entry) => claimTone(entry.ownership) === group.tone).length,
  })).filter((group) => group.count > 0)

  return (
    <ul className="tally" aria-label="Domains by status">
      {counts.map((group) => (
        <li key={group.tone} data-state={group.tone}>
          <span className="tally-dot" aria-hidden="true" />
          <span className="tally-count">{group.count}</span> {group.count === 1 ? group.one : group.many}
        </li>
      ))}
    </ul>
  )
}
