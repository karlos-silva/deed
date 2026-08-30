import { RESOLVERS, type Domain, type ResolverId } from '@deed/core'
import { RESOLVER_NAMES, humanTtl } from '@/lib/copy'

type Verdict = {
  readonly label: string
  readonly dot: string
  readonly ttl: number | null
}

/**
 * Show your work (prd §3.4): which resolvers we asked, what each returned, and
 * what we concluded. This is the difference between a verdict the user has to
 * trust and one they can audit.
 *
 * It is derived entirely from `record`, so it can never claim something the
 * state model does not say.
 */
export function ResolverMatrix({ domain }: { domain: Domain }) {
  const verdicts = verdictsFor(domain)

  return (
    <div className="matrix" role="table" aria-label="What each resolver answered">
      {RESOLVERS.map((resolver) => {
        const verdict = verdicts[resolver]
        return (
          <div className="matrix-row" role="row" key={resolver}>
            <span className="who" role="cell">
              <span className={`mdot ${verdict.dot}`} aria-hidden="true" />
              {RESOLVER_NAMES[resolver]}
            </span>
            <span className="ttl" role="cell">
              {verdict.ttl === null ? '' : `TTL ${humanTtl(verdict.ttl)}`}
            </span>
            <span className="verdict subtle" role="cell">
              {verdict.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function verdictsFor(domain: Domain): Record<ResolverId, Verdict> {
  const record = domain.record
  const blank = (label: string, dot = 'mdot-gray'): Verdict => ({ label, dot, ttl: null })
  const all = (verdict: Verdict): Record<ResolverId, Verdict> => ({
    cloudflare: verdict,
    google: verdict,
    adguard: verdict,
  })

  switch (record.status) {
    case 'unchecked':
      return all(blank('not looked yet'))

    case 'absent':
      return all(blank('no record'))

    case 'zone_error':
    case 'check_failed': {
      const out = all(blank('—'))
      for (const error of record.errors) {
        out[error.resolver] = blank(
          error.side === 'zone' ? `their zone: ${error.detail}` : `our lookup: ${error.detail}`,
          error.side === 'zone' ? 'mdot-red' : 'mdot-gray',
        )
      }
      return out
    }

    case 'verified':
    case 'propagating': {
      const out = all(blank(record.status === 'verified' ? 'no answer' : 'not yet'))
      const ttls = new Map(record.ttl.perResolver.map((t) => [t.resolver, t.ttl]))
      for (const resolver of record.seenBy) {
        out[resolver] = { label: 'has your token', dot: 'mdot-green', ttl: ttls.get(resolver) ?? null }
      }
      if (record.status === 'propagating') {
        for (const resolver of record.staleAt) {
          out[resolver] = {
            label: 'previous token, still cached',
            dot: 'mdot-yellow',
            ttl: ttls.get(resolver) ?? null,
          }
        }
      }
      return out
    }

    case 'mismatch': {
      const out = all(blank('no answer'))
      for (const observed of record.observed) {
        out[observed.resolver] = {
          label:
            observed.kind === 'current'
              ? 'has your token'
              : observed.kind === 'superseded'
                ? 'previous token, still cached'
                : observed.kind === 'wildcard_served'
                  ? 'answered by a wildcard'
                  : 'a different value',
          dot:
            observed.kind === 'current'
              ? 'mdot-green'
              : observed.kind === 'unknown'
                ? 'mdot-red'
                : 'mdot-yellow',
          ttl: null,
        }
      }
      return out
    }
  }
}
