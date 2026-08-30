import { RESOLVERS, type ResolverAnswer, type ResolverId, type Timestamp } from '@deed/core'
import { classifyLookup, ourFailure } from '../classify'
import { RCODE, type DnsPort, type RawRecord } from '../port'
import { type SandboxZone, answersFor, labelOf, visibleTo } from './zone'

/**
 * The sandbox resolver. It answers through the same classifier as DoH, so a
 * simulated SERVFAIL and a real one arrive at the engine identically (D2).
 *
 * Nothing here touches the network. That is asserted, not assumed: `.test`
 * routing is total, and a network mock records zero outbound requests.
 */
export function createSandboxPort(zone: SandboxZone): DnsPort {
  return {
    lookupTxt(host, context) {
      return Promise.resolve(RESOLVERS.map((resolver) => answer(zone, resolver, host, context.now)))
    },
  }
}

function answer(
  zone: SandboxZone,
  resolver: ResolverId,
  host: string,
  now: Timestamp,
): ResolverAnswer {
  switch (zone.outage) {
    case 'timeout':
    case 'throttled':
      return ourFailure(resolver, zone.outage)
    case 'servfail':
      return classifyLookup({ resolver, rcode: RCODE.servfail, records: [] })
    case 'dnssec':
      return classifyLookup({
        resolver,
        rcode: RCODE.servfail,
        records: [],
        comment: 'DNSSEC validation failure',
      })
    case 'refused':
      return classifyLookup({ resolver, rcode: RCODE.refused, records: [] })
    case null:
      break
  }

  const label = labelOf(host, zone.name)
  if (label === null) return classifyLookup({ resolver, rcode: RCODE.nxdomain, records: [] })

  const matched = answersFor(visibleTo(zone, resolver, now), label)
  if (matched.length === 0) {
    return classifyLookup({ resolver, rcode: RCODE.nxdomain, records: [] })
  }

  // A CNAME cannot coexist with other data at the same name, and it is *why*
  // the TXT cannot resolve (prd §7, `cname_at_host`).
  const cname = matched.find((r) => r.type === 'CNAME')
  const records: RawRecord[] =
    cname !== undefined
      ? [{ type: 'CNAME', ttl: cname.ttl, value: cname.value }]
      : matched
          .filter((r) => r.type === 'TXT')
          .map((r) => ({ type: 'TXT', ttl: r.ttl, value: r.value }))

  // The name exists and holds no TXT: nodata, never nxdomain.
  return classifyLookup({ resolver, rcode: RCODE.noerror, records })
}
