import { RESOLVERS, type ResolverAnswer, type ResolverId, type Timestamp } from '@deed/core'
import { classifyLookup, ourFailure } from '../classify'
import { RCODE, type DnsPort, type RawRecord, type RecordType } from '../port'
import { type SandboxZone, answersFor, labelOf, visibleTo } from './zone'

export function createSandboxPort(zone: SandboxZone): DnsPort {
  return {
    lookup(host, type, context) {
      return Promise.resolve(
        RESOLVERS.map((resolver) => answer(zone, resolver, host, type, context.now)),
      )
    },
  }
}

function answer(
  zone: SandboxZone,
  resolver: ResolverId,
  host: string,
  type: RecordType,
  now: Timestamp,
): ResolverAnswer {
  switch (zone.outage) {
    case 'timeout':
    case 'throttled':
      return ourFailure(resolver, zone.outage)
    case 'servfail':
      return classifyLookup({ resolver, rcode: RCODE.servfail, records: [] }, type)
    case 'dnssec':
      return classifyLookup(
        { resolver, rcode: RCODE.servfail, records: [], comment: 'DNSSEC validation failure' },
        type,
      )
    case 'refused':
      return classifyLookup({ resolver, rcode: RCODE.refused, records: [] }, type)
    case null:
      break
  }

  const label = labelOf(host, zone.name)
  if (label === null) return classifyLookup({ resolver, rcode: RCODE.nxdomain, records: [] }, type)

  const matched = answersFor(visibleTo(zone, resolver, now), label)
  if (matched.length === 0) {
    return classifyLookup({ resolver, rcode: RCODE.nxdomain, records: [] }, type)
  }

  // A CNAME cannot coexist with other data at the same name (prd §7, `cname_at_host`).
  const cname = matched.find((r) => r.type === 'CNAME')
  const records: RawRecord[] =
    cname !== undefined && type !== 'CNAME'
      ? [{ type: 'CNAME', ttl: cname.ttl, value: cname.value }]
      : matched.map((r) => ({ type: r.type, ttl: r.ttl, value: r.value }))

  // NOERROR with records of another type classifies as nodata, never nxdomain.
  return classifyLookup({ resolver, rcode: RCODE.noerror, records }, type)
}
