import { PUBLIC_SUFFIX_RULES } from './data/publicSuffixList'

/** Hardened per prd §8: DNS reads only, never an HTTP fetch to the user's domain. Every refusal happens before any lookup. */

export type ClaimName = {
  /** Punycode, lowercased, no trailing dot — the stored form. */
  readonly name: string
  /** Only where it differs; display punycode first so `аcme.com` cannot read as `acme.com` (prd §8). */
  readonly unicode: string | null
  /** `.test` routes to the simulated zone and never to real DNS (D2, D10). */
  readonly isSandbox: boolean
  readonly publicSuffix: string
}

export type ClaimRefusal =
  | { readonly reason: 'empty' }
  | { readonly reason: 'malformed'; readonly detail: MalformedDetail }
  | { readonly reason: 'not_a_public_domain'; readonly detail: NotPublicDetail }
  | { readonly reason: 'too_long'; readonly detail: 'label' | 'name'; readonly offending: string }
  /** Verifying a public suffix would be a catastrophic authority grant (prd §8). */
  | { readonly reason: 'public_suffix'; readonly suffix: string }

export type MalformedDetail = 'bad_characters' | 'empty_label' | 'no_dot' | 'unparseable'
export type NotPublicDetail = 'ip_literal' | 'localhost' | 'reserved_tld'

export type ClaimParse =
  | { readonly ok: true; readonly value: ClaimName }
  | { readonly ok: false; readonly error: ClaimRefusal }

/** RFC 2606 and RFC 6761 names that can never be public domains. */
const RESERVED_TLDS = new Set(['localhost', 'local', 'internal', 'invalid', 'example', 'onion', 'home', 'lan', 'corp'])
const SANDBOX_TLD = 'test'

const MAX_LABEL_BYTES = 63
const MAX_NAME_BYTES = 253

/** Accepts a pasted URL, trailing dot, uppercase, or IDN and normalises silently (prd §6). */
export function parseClaim(input: string): ClaimParse {
  const trimmed = input.trim()
  if (trimmed === '') return refuse({ reason: 'empty' })

  const host = extractHost(trimmed)
  if (host === null) return refuse({ reason: 'malformed', detail: 'unparseable' })

  if (isIpLiteral(host)) return refuse({ reason: 'not_a_public_domain', detail: 'ip_literal' })

  const name = host.replace(/\.$/, '').toLowerCase()
  if (name === '') return refuse({ reason: 'malformed', detail: 'unparseable' })

  const labels = name.split('.')
  if (labels.some((label) => label === '')) {
    return refuse({ reason: 'malformed', detail: 'empty_label' })
  }
  for (const label of labels) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return refuse({ reason: 'malformed', detail: 'bad_characters' })
    }
    if (byteLength(label) > MAX_LABEL_BYTES) {
      return refuse({ reason: 'too_long', detail: 'label', offending: label })
    }
  }
  if (byteLength(name) > MAX_NAME_BYTES) {
    return refuse({ reason: 'too_long', detail: 'name', offending: name })
  }

  const tld = labels.at(-1) ?? ''
  if (tld === 'localhost' || name === 'localhost') {
    return refuse({ reason: 'not_a_public_domain', detail: 'localhost' })
  }
  if (RESERVED_TLDS.has(tld)) {
    return refuse({ reason: 'not_a_public_domain', detail: 'reserved_tld' })
  }

  const isSandbox = tld === SANDBOX_TLD
  const suffix = publicSuffixOf(name)

  if (name === suffix) return refuse({ reason: 'public_suffix', suffix })
  if (labels.length < 2) return refuse({ reason: 'malformed', detail: 'no_dot' })

  const unicode = toUnicode(name)
  return {
    ok: true,
    value: { name, unicode: unicode === name ? null : unicode, isSandbox, publicSuffix: suffix },
  }
}

/** Bucketed by rightmost label: every rule ends in a concrete TLD, so a name only considers its own TLD's rules. */
let byTld: Map<string, string[]> | null = null

function rulesFor(tld: string): readonly string[] {
  if (byTld === null) {
    byTld = new Map()
    for (const rule of PUBLIC_SUFFIX_RULES) {
      const key = rule.slice(rule.lastIndexOf('.') + 1)
      const bucket = byTld.get(key)
      if (bucket === undefined) byTld.set(key, [rule])
      else bucket.push(rule)
    }
  }
  return byTld.get(tld) ?? []
}

/** The Public Suffix List algorithm: the exception rule if one matches, otherwise the longest match. */
export function publicSuffixOf(name: string): string {
  const labels = name.split('.')
  let prevailing: string[] | null = null
  let exception = false

  for (const rule of rulesFor(labels.at(-1) ?? name)) {
    const isException = rule.startsWith('!')
    const parts = (isException ? rule.slice(1) : rule).split('.')
    if (parts.length > labels.length) continue

    const tail = labels.slice(labels.length - parts.length)
    const matches = parts.every((part, i) => part === '*' || part === tail[i])
    if (!matches) continue

    if (isException) {
      // The exception's leftmost label belongs to the domain, so the suffix is one label shorter.
      prevailing = parts.slice(1)
      exception = true
      break
    }
    if (prevailing === null || parts.length > prevailing.length) prevailing = parts
  }

  if (prevailing === null) return labels.at(-1) ?? name
  if (!exception && prevailing.includes('*')) {
    return labels.slice(labels.length - prevailing.length).join('.')
  }
  return prevailing.join('.')
}

export const isPublicSuffix = (name: string): boolean => publicSuffixOf(name) === name

const refuse = (error: ClaimRefusal): ClaimParse => ({ ok: false, error })

const byteLength = (value: string): number => new TextEncoder().encode(value).length

/** `URL` accepts a pasted browser-bar string and does IDN → punycode, so a name arrives in its stored form. */
function extractHost(input: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`
  try {
    const { hostname } = new URL(candidate)
    return hostname === '' ? null : hostname
  } catch {
    return null
  }
}

const isIpLiteral = (host: string): boolean =>
  host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9a-f]*:[0-9a-f:.]*$/i.test(host)

function toUnicode(name: string): string {
  if (!name.includes('xn--')) return name
  try {
    return name
      .split('.')
      .map((label) => (label.startsWith('xn--') ? decodePunycode(label.slice(4)) ?? label : label))
      .join('.')
  } catch {
    return name
  }
}

/* eslint-disable @typescript-eslint/no-misused-spread -- RFC 3492 operates on code points, which is exactly what spreading a string yields. */

/** RFC 3492 decoding, the half `URL` does not expose. */
function decodePunycode(input: string): string | null {
  const BASE = 36
  const TMIN = 1
  const TMAX = 26
  const SKEW = 38
  const DAMP = 700
  const INITIAL_BIAS = 72
  const INITIAL_N = 128

  const adapt = (delta: number, count: number, first: boolean): number => {
    let d = first ? Math.floor(delta / DAMP) : delta >> 1
    d += Math.floor(d / count)
    let k = 0
    while (d > ((BASE - TMIN) * TMAX) >> 1) {
      d = Math.floor(d / (BASE - TMIN))
      k += BASE
    }
    return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW))
  }

  const split = input.lastIndexOf('-')
  const basic = split > 0 ? input.slice(0, split) : ''
  const output = [...basic]
  let i = 0
  let n = INITIAL_N
  let bias = INITIAL_BIAS

  for (let at = split > 0 ? split + 1 : 0; at < input.length; ) {
    const previous = i
    for (let weight = 1, k = BASE; ; k += BASE) {
      const code = input.codePointAt(at++)
      if (code === undefined) return null
      const digit =
        code - 48 < 10 ? code - 22 : code - 65 < 26 ? code - 65 : code - 97 < 26 ? code - 97 : BASE
      if (digit >= BASE) return null
      i += digit * weight
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
      if (digit < t) break
      weight *= BASE - t
    }
    bias = adapt(i - previous, output.length + 1, previous === 0)
    n += Math.floor(i / (output.length + 1))
    i %= output.length + 1
    output.splice(i, 0, String.fromCodePoint(n))
    i++
  }
  return output.join('')
}
