import { RESOLVERS, type Domain, type ResolverId } from '@deed/core'
import { RESOLVER_NAMES, humanTtl } from '@/lib/copy'

type Answer = {
  readonly label: string
  readonly state: 'ok' | 'progress' | 'problem' | 'idle'
  readonly ttl: number | null
}

/**
 * Which resolvers we asked, what each returned, and what we concluded (prd §3.4).
 * A table, because that is what it is: three independent caches answering the
 * same question, and the point is comparing them.
 */
export function ResolverMatrix({ domain, checking }: { domain: Domain; checking?: boolean }) {
  const answers = answersFor(domain)

  return (
    <table className={`matrix${checking === true ? ' scanning' : ''}`}>
      <caption className="sr-only">What each resolver answered</caption>
      <thead>
        <tr>
          <th scope="col">Resolver</th>
          <th scope="col">Answer</th>
          <th scope="col" className="num">
            Cached for
          </th>
        </tr>
      </thead>
      <tbody>
        {RESOLVERS.map((resolver) => {
          const answer = answers[resolver]
          return (
            <tr key={resolver} data-state={answer.state === 'idle' ? undefined : answer.state}>
              <th scope="row">
                <span className="mdot" aria-hidden="true" />
                {RESOLVER_NAMES[resolver]}
              </th>
              <td className="said">{answer.label}</td>
              <td className="num">{answer.ttl === null ? '—' : humanTtl(answer.ttl)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function answersFor(domain: Domain): Record<ResolverId, Answer> {
  const record = domain.record
  const idle = (label: string): Answer => ({ label, state: 'idle', ttl: null })
  const all = (answer: Answer): Record<ResolverId, Answer> => ({
    cloudflare: answer,
    google: answer,
    adguard: answer,
  })

  switch (record.status) {
    case 'unchecked':
      return all(idle('not asked yet'))

    case 'absent':
      return all(idle('no such record'))

    case 'zone_error':
    case 'check_failed': {
      const out = all(idle('—'))
      for (const error of record.errors) {
        out[error.resolver] =
          error.side === 'zone'
            ? { label: `their zone: ${error.detail}`, state: 'problem', ttl: null }
            : { label: `our lookup: ${error.detail}`, state: 'idle', ttl: null }
      }
      return out
    }

    case 'verified':
    case 'propagating': {
      const out = all(idle(record.status === 'verified' ? 'no answer' : 'not yet'))
      const ttls = new Map(record.ttl.perResolver.map((t) => [t.resolver, t.ttl]))
      for (const resolver of record.seenBy) {
        out[resolver] = { label: 'has your token', state: 'ok', ttl: ttls.get(resolver) ?? null }
      }
      if (record.status === 'propagating') {
        for (const resolver of record.staleAt) {
          out[resolver] = {
            label: 'your previous token',
            state: 'progress',
            ttl: ttls.get(resolver) ?? null,
          }
        }
      }
      return out
    }

    case 'mismatch': {
      const out = all(idle('no answer'))
      for (const observed of record.observed) {
        out[observed.resolver] =
          observed.kind === 'current'
            ? { label: 'has your token', state: 'ok', ttl: null }
            : observed.kind === 'superseded'
              ? { label: 'your previous token', state: 'progress', ttl: null }
              : observed.kind === 'wildcard_served'
                ? { label: 'a wildcard answered', state: 'progress', ttl: null }
                : { label: 'a different value', state: 'problem', ttl: null }
      }
      return out
    }
  }
}
