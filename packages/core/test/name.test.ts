import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PUBLIC_SUFFIX_RULES } from '../src/data/publicSuffixList'
import { isPublicSuffix, parseClaim, publicSuffixOf, zoneOf } from '../src/name'

const accepted = (input: string) => {
  const parsed = parseClaim(input)
  expect(parsed.ok, `${input} was refused`).toBe(true)
  if (!parsed.ok) throw new Error('unreachable')
  return parsed.value
}

const refused = (input: string) => {
  const parsed = parseClaim(input)
  expect(parsed.ok, `${input} was accepted`).toBe(false)
  if (parsed.ok) throw new Error('unreachable')
  return parsed.error
}

describe('claiming a name', () => {
  it('A pasted URL is accepted without complaint', () => {
    // The user pasted this out of their browser bar. Complaining about the
    // shape of it is not the product's job (prd §6).
    for (const input of [
      'HTTPS://Updates.ACME.com/path/',
      'updates.acme.com',
      '  updates.acme.com  ',
      'updates.acme.com.',
      'http://updates.acme.com:8443/x?y=1',
      'UPDATES.ACME.COM',
    ]) {
      expect(accepted(input).name, input).toBe('updates.acme.com')
    }
  })

  it('an IDN is stored as punycode and displayed alongside its Unicode form', () => {
    // Never Unicode alone: a product about proving identity does not let
    // `аcme.com` read as `acme.com` (prd §8).
    const parsed = accepted('bücher.de')
    expect(parsed.name).toBe('xn--bcher-kva.de')
    expect(parsed.unicode).toBe('bücher.de')

    expect(accepted('acme.com').unicode).toBeNull()
  })

  it('A public suffix cannot be claimed', () => {
    for (const suffix of ['co.uk', 'github.io', 'com', 'uk', 'com.br', 's3.amazonaws.com']) {
      expect(refused(suffix), suffix).toMatchObject({ reason: 'public_suffix' })
    }
    // One label past the suffix is a domain, and is claimable.
    expect(accepted('acme.co.uk').publicSuffix).toBe('co.uk')
    expect(accepted('karlos.github.io').publicSuffix).toBe('github.io')
  })

  it('every entry in the Public Suffix List is rejected, sampled as a property', () => {
    // Asserted over the list itself, so this holds as the list grows (S3).
    const plain = PUBLIC_SUFFIX_RULES.filter((r) => !r.startsWith('!') && !r.includes('*'))
    fc.assert(
      fc.property(fc.constantFrom(...plain), (rule) => {
        expect(isPublicSuffix(rule), rule).toBe(true)
        expect(parseClaim(rule).ok, rule).toBe(false)
      }),
      { numRuns: 2_000 },
    )
  })

  it('reads wildcard and exception rules the way the list defines them', () => {
    // `*.ck` makes every second-level name under `.ck` a suffix…
    expect(publicSuffixOf('foo.ck')).toBe('foo.ck')
    // …and `!www.ck` carves exactly one back out.
    expect(publicSuffixOf('www.ck')).toBe('ck')
    expect(accepted('www.ck').publicSuffix).toBe('ck')
  })

  it('Names that are not public domains are refused', () => {
    expect(refused('192.168.1.1')).toMatchObject({ detail: 'ip_literal' })
    expect(refused('8.8.8.8')).toMatchObject({ detail: 'ip_literal' })
    expect(refused('[2001:db8::1]')).toMatchObject({ detail: 'ip_literal' })
    expect(refused('localhost')).toMatchObject({ detail: 'localhost' })
    expect(refused('printer.local')).toMatchObject({ detail: 'reserved_tld' })
    expect(refused('db.internal')).toMatchObject({ detail: 'reserved_tld' })
    expect(refused('acme.invalid')).toMatchObject({ detail: 'reserved_tld' })

    const longLabel = `${'a'.repeat(64)}.acme.com`
    expect(refused(longLabel)).toMatchObject({ reason: 'too_long', detail: 'label' })

    const longName = `${Array.from({ length: 5 }, () => 'a'.repeat(50)).join('.')}.com`
    expect(refused(longName)).toMatchObject({ reason: 'too_long', detail: 'name' })

    // `.test` is the one reserved-suffix exception, and it routes to the sandbox.
    expect(accepted('acme.test')).toMatchObject({ name: 'acme.test', isSandbox: true })
    expect(accepted('updates.acme.test').isSandbox).toBe(true)

    // A sandbox name needs at least one label of its own.
    expect(refused('test')).toMatchObject({ reason: 'public_suffix', suffix: 'test' })
  })

  it('refuses what is not a name at all, before any lookup is attempted', () => {
    for (const input of ['', '   ', '.', '..', 'acme..com', '-acme.com', 'acme-.com', 'a b.com']) {
      expect(parseClaim(input).ok, input).toBe(false)
    }
  })

  it('never accepts a name it would not store verbatim', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (input) => {
        const parsed = parseClaim(input)
        if (!parsed.ok) return
        const { name } = parsed.value
        expect(name).toBe(name.toLowerCase())
        expect(name.endsWith('.')).toBe(false)
        expect(name).toMatch(/^[a-z0-9.-]+$/)
        // Re-parsing the stored form is a fixed point.
        expect(parseClaim(name)).toEqual(parsed)
      }),
    )
  })
})

describe('the zone a record is added in', () => {
  it('is the public suffix plus one label, not the last two', () => {
    // The apex case is the one counting labels gets right, which is why it hid
    // the other three for so long.
    expect(zoneOf('acme.com')).toBe('acme.com')
    expect(zoneOf('demo.karlos.dev')).toBe('karlos.dev')
    expect(zoneOf('a.b.example.com')).toBe('example.com')

    // Two-label suffix: counting from the right would have said `acme.co`,
    // which is not a zone anyone can open.
    expect(zoneOf('shop.acme.co.uk')).toBe('acme.co.uk')
    expect(zoneOf('acme.co.uk')).toBe('acme.co.uk')
  })

  it('follows the list rather than the dots', () => {
    // A wildcard rule: everything under `ck` is a suffix…
    expect(zoneOf('shop.www.ck')).toBe('www.ck')
    // …except `www.ck`, which the exception rule hands back to its owner.
    expect(zoneOf('www.ck')).toBe('www.ck')

    // The sandbox suffix is in no list, so the fallback is the bare TLD.
    expect(zoneOf('acme.test')).toBe('acme.test')
    expect(zoneOf('a.acme.test')).toBe('acme.test')
  })

  it('always leaves a name it can be split back out of', () => {
    for (const name of ['acme.com', 'demo.karlos.dev', 'shop.acme.co.uk', 'a.b.example.com']) {
      const zone = zoneOf(name)
      expect(name === zone || name.endsWith(`.${zone}`), name).toBe(true)
    }
  })
})
