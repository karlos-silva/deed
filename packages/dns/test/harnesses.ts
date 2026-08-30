import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ResolverId, type Timestamp, challengeHost, plus, seconds } from '@deed/core'
import { T0, VALUE_A } from '@deed/core/testing'
import { createDohPort } from '../src/doh/adapter'
import { createSandboxPort } from '../src/sandbox/adapter'
import { type SandboxZone, addRecord, emptyZone, setOutage } from '../src/sandbox/zone'
import type { ContractCase, ContractHarness, Staged } from './contract'

export const NAME = 'acme.test'
export const PROBE_LABEL = 'q7x2m9velbn4tk1sjh0d'
export const WILDCARD = 'v=spf1 -all'
/** Past every resolver's propagation delay, so the sandbox zone is settled. */
export const SETTLED = plus(T0, seconds(200))

/* ------------------------------- the sandbox ------------------------------ */

let counter = 0
const nextId = () => `r${++counter}`

const txt =
  (host: string, value: string, at: Timestamp = T0) =>
  (zone: SandboxZone): SandboxZone =>
    addRecord(zone, { id: nextId(), host, value }, at)

const zone = (...build: ((z: SandboxZone) => SandboxZone)[]): SandboxZone =>
  build.reduce((z, step) => step(z), emptyZone(NAME))

/** A 2048-bit DKIM key is the shape that actually crosses 255 bytes. */
const LONG = `v=DKIM1;k=rsa;p=${'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA'.repeat(9)}`

export const sandboxHarness: ContractHarness = {
  name: 'sandbox',
  stage(kase: ContractCase): Promise<Staged> {
    const base = { host: challengeHost(NAME), probeHost: `${PROBE_LABEL}.${NAME}`, now: SETTLED }
    const staged = (z: SandboxZone, value?: string): Staged =>
      value === undefined
        ? { ...base, port: createSandboxPort(z) }
        : { ...base, port: createSandboxPort(z), value }

    switch (kase) {
      case 'single-value':
        return Promise.resolve(staged(zone(txt('_deed-challenge', VALUE_A)), VALUE_A))
      case 'chunked-value':
        return Promise.resolve(staged(zone(txt('_deed-challenge', LONG)), LONG))
      case 'multiple-records':
        return Promise.resolve(
          staged(
            zone(txt('_deed-challenge', VALUE_A), txt('_deed-challenge', WILDCARD)),
            VALUE_A,
          ),
        )
      case 'nxdomain':
        return Promise.resolve(staged(emptyZone(NAME)))
      case 'nodata':
        return Promise.resolve(
          staged(
            addRecord(
              emptyZone(NAME),
              { id: nextId(), host: '_deed-challenge', type: 'A', value: '203.0.113.10' },
              T0,
            ),
          ),
        )
      case 'cname-at-host':
        return Promise.resolve(
          staged(
            addRecord(
              emptyZone(NAME),
              {
                id: nextId(),
                host: '_deed-challenge',
                type: 'CNAME',
                value: 'shop.myshopify.com',
              },
              T0,
            ),
          ),
        )
      case 'servfail':
      case 'refused':
      case 'dnssec':
      case 'timeout':
      case 'throttled':
        return Promise.resolve(staged(setOutage(zone(txt('_deed-challenge', VALUE_A)), kase)))
      case 'wildcard-only':
        return Promise.resolve(staged(zone(txt('*', WILDCARD)), WILDCARD))
      case 'wildcard-and-record':
        return Promise.resolve(
          staged(zone(txt('*', WILDCARD), txt('_deed-challenge', VALUE_A)), VALUE_A),
        )
    }
  },
}

/* --------------------------------- the DoH -------------------------------- */

const fixtures = dirname(fileURLToPath(import.meta.url))

type Fixture = {
  host: string
  responses: Record<string, { body: unknown }>
}

const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(fixtures, 'fixtures', `${name}.json`), 'utf8')) as Fixture

/** The one TXT record at `mail.google.com`, straight out of the committed fixture. */
export const SINGLE_VALUE =
  'google-site-verification=PncXpRKRCAlDAdlesTtNFf6k9TvgxgcRfojdaKkEACY'

type Reply =
  | { readonly json: unknown }
  | { readonly status: number }
  | { readonly fail: 'TimeoutError' | 'network' }

const RESOLVER_BY_HOST: Record<string, ResolverId> = {
  'cloudflare-dns.com': 'cloudflare',
  'dns.google': 'google',
  'unfiltered.adguard-dns.com': 'adguard',
}

export function stubFetch(
  reply: (resolver: ResolverId, host: string) => Reply,
): typeof globalThis.fetch {
  return (input) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href)
    const resolver = RESOLVER_BY_HOST[url.hostname]
    if (resolver === undefined) throw new Error(`unexpected resolver: ${url.hostname}`)
    const host = url.searchParams.get('name') ?? ''

    const answer = reply(resolver, host)
    if ('fail' in answer) {
      const error = new Error(answer.fail)
      error.name = answer.fail === 'TimeoutError' ? 'TimeoutError' : 'TypeError'
      return Promise.reject(error)
    }
    if ('status' in answer) {
      return Promise.resolve(new Response('', { status: answer.status }))
    }
    return Promise.resolve(
      new Response(JSON.stringify(answer.json), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      }),
    )
  }
}

const fromFixture = (name: string): { host: string; reply: (r: ResolverId) => Reply } => {
  const captured = fixture(name)
  return {
    host: captured.host,
    reply: (resolver) => ({ json: captured.responses[resolver]?.body ?? { Status: 2 } }),
  }
}

const txtJson = (value: string) => ({
  Status: 0,
  Answer: [{ name: 'x', type: 16, TTL: 300, data: `"${value}"` }],
})

/**
 * Fixture-backed wherever a public resolver can actually produce the case, and
 * synthesized — in the shape those resolvers really return — where it cannot.
 * REFUSED, throttling and a wildcard zone are not things example.com will do on
 * request; every other case here is a recording of a real answer.
 */
export const dohHarness: ContractHarness = {
  name: 'doh',
  stage(kase: ContractCase): Promise<Staged> {
    const probeHost = `${PROBE_LABEL}.example.com`
    const make = (host: string, reply: (r: ResolverId, h: string) => Reply, value?: string): Staged => {
      const port = createDohPort({ fetch: stubFetch(reply) })
      const base = { port, host, probeHost, now: T0 }
      return value === undefined ? base : { ...base, value }
    }

    switch (kase) {
      case 'single-value': {
        const f = fromFixture('single-value')
        return Promise.resolve(make(f.host, f.reply, SINGLE_VALUE))
      }
      case 'chunked-value': {
        const f = fromFixture('chunked-value')
        // No literal here on purpose: the contract asserts all three transports
        // decode the same >255-byte value, which is the property that matters.
        return Promise.resolve(make(f.host, f.reply))
      }
      case 'multiple-records': {
        const f = fromFixture('multiple-records')
        return Promise.resolve(make(f.host, f.reply))
      }
      case 'nxdomain': {
        const f = fromFixture('nxdomain')
        return Promise.resolve(make(f.host, f.reply))
      }
      case 'nodata': {
        const f = fromFixture('nodata')
        return Promise.resolve(make(f.host, f.reply))
      }
      case 'cname-at-host': {
        const f = fromFixture('cname-at-host')
        return Promise.resolve(make(f.host, f.reply))
      }
      case 'dnssec': {
        const f = fromFixture('dnssec-failure')
        return Promise.resolve(make(f.host, f.reply))
      }
      case 'servfail':
        return Promise.resolve(make('example.com', () => ({ json: { Status: 2 } })))
      case 'refused':
        return Promise.resolve(make('example.com', () => ({ json: { Status: 5 } })))
      case 'timeout':
        return Promise.resolve(make('example.com', () => ({ fail: 'TimeoutError' })))
      case 'throttled':
        return Promise.resolve(make('example.com', () => ({ status: 429 })))
      case 'wildcard-only':
        return Promise.resolve(
          make('_deed-challenge.example.com', () => ({ json: txtJson(WILDCARD) }), WILDCARD),
        )
      case 'wildcard-and-record':
        return Promise.resolve(
          make(
            '_deed-challenge.example.com',
            (_resolver, host) => ({ json: txtJson(host === probeHost ? WILDCARD : VALUE_A) }),
            VALUE_A,
          ),
        )
    }
  },
}
