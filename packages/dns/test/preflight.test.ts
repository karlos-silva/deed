import { describe, expect, it } from 'vitest'
import { at, parseClaim } from '@deed/core'
import { createDohPort } from '../src/doh/adapter'
import { createSandboxPort } from '../src/sandbox/adapter'
import { addRecord, emptyZone } from '../src/sandbox/zone'
import { preflight } from '../src/preflight'
import { T0, VALUE_A } from '@deed/core/testing'

/**
 * Reading the zone before a token is issued is what turns a failure into a
 * warning (prd §3.2). Nothing here may prevent a claim.
 */

type Answers = Record<string, { type: number; data: string }[]>

/** A zone, as the three resolvers would report it. */
const zoneStub = (answers: Answers): typeof globalThis.fetch =>
  (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const name = url.searchParams.get('name') ?? ''
    const type = url.searchParams.get('type') ?? 'TXT'
    const found = answers[`${name}|${type}`]
    return Promise.resolve(
      new Response(
        JSON.stringify(found === undefined ? { Status: 3 } : { Status: 0, Answer: found }),
        { status: 200, headers: { 'content-type': 'application/dns-json' } },
      ),
    )
  }

const ns = (...hosts: string[]) => hosts.map((data) => ({ type: 2, data }))
const txt = (value: string) => [{ type: 16, data: `"${value}"` }]

const PROBE = 'q7x2m9velbn4tk1sjh0d'
const run = (answers: Answers, name = 'acme.com') =>
  preflight(createDohPort({ fetch: zoneStub(answers) }), name, { now: at(0), probeLabel: PROBE })

describe('pre-flight', () => {
  it('Pre-flight warns before the mistake, and never blocks', async () => {
    const found = await run({
      'acme.com|NS': ns('lena.ns.cloudflare.com.', 'rob.ns.cloudflare.com.'),
    })

    // The zone is Cloudflare's, so the instructions can use Cloudflare's own
    // field names rather than generic ones.
    expect(found.provider?.name).toBe('Cloudflare')
    expect(found.provider?.hostLabel).toBe('Name')
    expect(found.provider?.valueLabel).toBe('Content')

    // And the warning about what that panel does to a value arrives now —
    // before the token exists, let alone before it has been pasted.
    expect(found.warnings).toContainEqual(
      expect.objectContaining({ kind: 'provider_quirk', cause: 'quoted_value' }),
    )

    // Everything it produces is a warning. There is no outcome that stops a
    // claim: we can be wrong about a zone, and the user cannot be wrong about
    // owning their own domain.
    expect(Object.keys(found)).not.toContain('blocked')
    expect(parseClaim('acme.com').ok).toBe(true)
  })

  it('names the provider from the nameservers, or admits it does not know', async () => {
    const cases: [string[], string | null][] = [
      [['ns-1.awsdns-01.org'], 'Route 53'],
      [['ns-cloud-d1.googledomains.com'], 'Google Cloud DNS'],
      [['ns1.squarespacedns.com'], 'Squarespace'],
      [['ns01.domaincontrol.com'], 'GoDaddy'],
      [['dns1.p05.nsone.net'], 'NS1'],
      [['ns1.some-tiny-host.example'], null],
    ]
    for (const [hosts, expected] of cases) {
      const found = await run({ 'acme.com|NS': ns(...hosts) })
      expect(found.provider?.name ?? null, hosts.join()).toBe(expected)
    }
  })

  it('warns that a name nobody has delegated will look like a missing record', async () => {
    // At check time `domain_unregistered` is indistinguishable from `absent`.
    // Now is the only moment the difference can be told (state-model §3).
    const found = await run({})
    expect(found.registered).toBe(false)
    expect(found.warnings).toContainEqual({ kind: 'domain_unregistered' })
  })

  it('spots a wildcard before it makes a missing record look present', async () => {
    const found = await run({
      'acme.com|NS': ns('ns1.squarespacedns.com'),
      [`${PROBE}.acme.com|TXT`]: txt('v=spf1 -all'),
    })
    expect(found.wildcard).toBe('v=spf1 -all')
    expect(found.warnings).toContainEqual({ kind: 'wildcard', value: 'v=spf1 -all' })
  })

  it('spots a CNAME already sitting on the challenge host', async () => {
    const found = await run({
      'acme.com|NS': ns('ns1.squarespacedns.com'),
      '_deed-challenge.acme.com|CNAME': [{ type: 5, data: 'shop.myshopify.com.' }],
    })
    expect(found.cnameAtHost).toBe('shop.myshopify.com')
    expect(found.warnings).toContainEqual({
      kind: 'cname_at_host',
      target: 'shop.myshopify.com',
    })
  })

  it('runs against the simulated zone too, so the sandbox is not a special case', async () => {
    const zone = addRecord(
      emptyZone('acme.test'),
      { id: 'w', host: '*', value: VALUE_A },
      T0,
    )
    const found = await preflight(createSandboxPort(zone), 'acme.test', {
      now: at(T0 + 200_000),
      probeLabel: PROBE,
    })
    expect(found.wildcard).toBe(VALUE_A)
    expect(found.warnings.some((w) => w.kind === 'wildcard')).toBe(true)
  })
})
