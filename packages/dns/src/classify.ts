import type { ResolverAnswer, ResolverId } from '@deed/core'
import { RCODE, type RawLookup, type RecordType } from './port'

/**
 * One classifier, shared by every transport. Their failure and our failure are
 * different things and must never be collapsed: SERVFAIL, REFUSED or a DNSSEC
 * validation failure is a real problem in the user's zone and they must be told;
 * a timeout or a throttle is *our* failure, and dressing it up as a DNS problem
 * sends the user to debug a zone that is fine (state-model §3).
 */
export function classifyLookup(raw: RawLookup, asked: RecordType = 'TXT'): ResolverAnswer {
  const { resolver } = raw

  switch (raw.rcode) {
    case RCODE.noerror: {
      const txt = raw.records.filter((r) => r.type === asked)
      const cname = raw.records.find((r) => r.type === 'CNAME')?.value
      if (txt.length === 0) {
        // The name exists but holds no TXT — usually a CNAME or a typo'd host.
        return cname === undefined
          ? { resolver, outcome: 'nodata' }
          : { resolver, outcome: 'nodata', cname }
      }
      // The soonest any of these answers can change is the shortest TTL.
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
      // A DNSSEC failure and a plain SERVFAIL both mean their zone, but they
      // send the user to different places, so the distinction is kept.
      return {
        resolver,
        outcome: 'zone_error',
        detail: looksLikeDnssec(raw.comment ?? '') ? 'dnssec' : 'servfail',
      }

    default:
      // FORMERR, NOTIMP and the rest: the zone did not answer usefully. It is
      // still their side — we sent a well-formed question.
      return { resolver, outcome: 'zone_error', detail: 'servfail' }
  }
}

/**
 * Extended DNS Error codes 6–12 are the DNSSEC failures (RFC 8914). No two
 * resolvers report them the same way, so both the codes and the vocabulary are
 * matched — see the captured fixtures for all three dialects.
 */
const looksLikeDnssec = (text: string): boolean =>
  /dnssec|dnskey|rrsig|nsec/i.test(text) || /\bEDE\D{0,3}(6|7|8|9|10|11|12)\b/i.test(text)

/** Every way a lookup can fail on *our* side. Never evidence about their zone. */
export function ourFailure(
  resolver: ResolverId,
  detail: 'timeout' | 'network' | 'throttled',
): ResolverAnswer {
  return { resolver, outcome: 'check_failed', detail }
}
