import { describe, expect, it } from 'vitest'
import { fromJson } from '../src/doh/adapter'
import { classifyLookup } from '../src/classify'
import { describeResolverContract } from './contract'
import { dohHarness } from './harnesses'

describe('the DoH adapter', () => {
  describeResolverContract(dohHarness)
})

describe('the three resolvers disagree about everything except the answer', () => {
  it('reads a quoted value and a bare one to the same string', () => {
    const cloudflare = fromJson('cloudflare', {
      Status: 0,
      Answer: [{ type: 16, TTL: 300, data: '"v=spf1 -all"' }],
    })
    const google = fromJson('google', {
      Status: 0,
      Answer: [{ type: 16, TTL: 300, data: 'v=spf1 -all' }],
    })
    expect(cloudflare.records).toEqual(google.records)
  })

  it('finds the DNSSEC failure in whichever field each resolver hid it in', () => {
    // All three from the committed fixture, and no two alike.
    const cloudflare = fromJson('cloudflare', {
      Status: 2,
      Comment: ['EDE(9): DNSKEY Missing no SEP matching the DS found for dnssec-failed.org.'],
    })
    const google = fromJson('google', {
      Status: 2,
      Comment: 'DNSSEC validation failure. Check http://dnsviz.net/…',
      extended_dns_errors: [{ info_code: 9, extra_text: 'No DNSKEY matches DS RRs' }],
    })
    const adguard = fromJson('adguard', {
      Status: 2,
      Extra: [{ type: 41, data: '\n;; OPT PSEUDOSECTION:\n; EDE: 6 (DNSSEC Bogus): ()' }],
    })

    for (const raw of [cloudflare, google, adguard]) {
      expect(classifyLookup(raw)).toMatchObject({ outcome: 'zone_error', detail: 'dnssec' })
    }
  })

  it('a plain SERVFAIL stays a plain SERVFAIL', () => {
    expect(classifyLookup(fromJson('cloudflare', { Status: 2 }))).toMatchObject({
      outcome: 'zone_error',
      detail: 'servfail',
    })
  })

  it('an unknown RCODE is still their zone, not our lookup', () => {
    // We sent a well-formed question; whatever came back is the zone's problem.
    expect(classifyLookup(fromJson('google', { Status: 4 }))).toMatchObject({
      outcome: 'zone_error',
      detail: 'servfail',
    })
  })
})
