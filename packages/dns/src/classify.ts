import type { ResolverAnswer, ResolverId } from '@deed/core'
import { RCODE, type RawLookup, type RecordType } from './port'

/** Their zone failing and our check failing must never collapse (state-model §3). */
export function classifyLookup(raw: RawLookup, asked: RecordType = 'TXT'): ResolverAnswer {
  const { resolver } = raw

  switch (raw.rcode) {
    case RCODE.noerror: {
      const txt = raw.records.filter((r) => r.type === asked)
      const cname = raw.records.find((r) => r.type === 'CNAME')?.value
      if (txt.length === 0) {
        return cname === undefined
          ? { resolver, outcome: 'nodata' }
          : { resolver, outcome: 'nodata', cname }
      }
      const ttl = txt.reduce((min, r) => Math.min(min, r.ttl), Number.POSITIVE_INFINITY)
      const values = txt.map((r) => r.value)
      return cname === undefined
        ? { resolver, outcome: 'answered', values, ttl }
        : { resolver, outcome: 'answered', values, ttl, cname }
    }

    case RCODE.nxdomain: {
      const cname = raw.records.find((r) => r.type === 'CNAME')?.value
      return cname === undefined
        ? { resolver, outcome: 'nxdomain' }
        : { resolver, outcome: 'nxdomain', cname }
    }

    case RCODE.refused:
      return { resolver, outcome: 'zone_error', detail: 'refused' }

    case RCODE.servfail:
      return {
        resolver,
        outcome: 'zone_error',
        detail: looksLikeDnssec(raw.comment ?? '') ? 'dnssec' : 'servfail',
      }

    default:
      return { resolver, outcome: 'zone_error', detail: 'servfail' }
  }
}

/** DNSSEC failures are EDE 6–12 (RFC 8914); each resolver words them differently. */
const looksLikeDnssec = (text: string): boolean =>
  /dnssec|dnskey|rrsig|nsec/i.test(text) || /\bEDE\D{0,3}(6|7|8|9|10|11|12)\b/i.test(text)

export function ourFailure(
  resolver: ResolverId,
  detail: 'timeout' | 'network' | 'throttled',
): ResolverAnswer {
  return { resolver, outcome: 'check_failed', detail }
}
