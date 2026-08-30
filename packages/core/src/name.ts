import { PUBLIC_SUFFIX_RULES } from './data/publicSuffixList'

/**
 * What may be claimed, and what may not.
 *
 * The lookup endpoint takes user input and must be hardened (prd §8): DNS reads
 * only, never an HTTP fetch to the user's domain, and no claims on names that
 * are not public domains. Every refusal here happens before a single lookup is
 * attempted.
 */

export type ClaimName = {
  /** Punycode, lowercased, no trailing dot — the stored form. */
  readonly name: string
  /**
   * The Unicode form, only where it differs. Names display as punycode first: a
   * product about proving identity does not let `аcme.com` read as `acme.com`
   * (prd §8).
   */
  readonly unicode: string | null
  /** `.test` routes to the simulated zone and never to real DNS (D2, D10). */
  readonly isSandbox: boolean
  /** The public suffix this name sits under, e.g. `co.uk` for `shop.acme.co.uk`. */
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

/**
 * Accepts a pasted URL, a trailing dot, uppercase, or an IDN, and normalises
 * silently (prd §6). The user pasted something reasonable; complaining about
 * the shape of it is not the product's job.
 */
export function parseClaim(input: string): ClaimParse {
  const trimmed = input.trim()
  if (trimmed === '') return refuse({ reason: 'empty' })

  const host = extractHost(trimmed)
  if (host === null) return refuse({ reason: 'malformed', detail: 'unparseable' })

  // An IP literal is not a domain, and asking DNS about one is meaningless.
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

  // `.test` is the single reserved-suffix exception, and it routes to the
  // sandbox, never to real DNS (D2, D10).
  const isSandbox = tld === SANDBOX_TLD
  const suffix = publicSuffixOf(name)

  // A sandbox name still needs at least one label of its own; `test` itself is
  // the suffix, not a domain.
  if (name === suffix) return refuse({ reason: 'public_suffix', suffix })
  if (labels.length < 2) return refuse({ reason: 'malformed', detail: 'no_dot' })

  const unicode = toUnicode(name)
  return {
    ok: true,
    value: { name, unicode: unicode === name ? null : unicode, isSandbox, publicSuffix: suffix },
  }
}

/**
 * Rules bucketed by their rightmost label. Every rule ends in a concrete TLD —
 * the wildcard is always leftmost — so a name only ever has to consider the
 * handful of rules under its own TLD instead of all ten thousand. This runs on
 * every claim and every pre-flight keystroke pause, so it is worth the map.
 */
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

/**
 * The Public Suffix List algorithm, as the list itself specifies it: the
 * prevailing rule is the exception rule if one matches, otherwise the longest
 * matching rule; a name matching nothing falls back to the implicit `*`.
 */
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

    // An exception rule wins outright; among the rest, the longest wins.
    if (isException) {
      // The exception's own leftmost label becomes part of the domain, so the
      // public suffix is one label shorter than the rule.
      prevailing = parts.slice(1)
      exception = true
      break
    }
    if (prevailing === null || parts.length > prevailing.length) prevailing = parts
  }

  if (prevailing === null) return labels.at(-1) ?? name
  if (!exception && prevailing.includes('*')) {
    // A wildcard rule matches whatever label sat in its place.
    return labels.slice(labels.length - prevailing.length).join('.')
  }
  return prevailing.join('.')
}

export const isPublicSuffix = (name: string): boolean => publicSuffixOf(name) === name

/* --------------------------------- details -------------------------------- */

const refuse = (error: ClaimRefusal): ClaimParse => ({ ok: false, error })

const byteLength = (value: string): number => new TextEncoder().encode(value).length

/**
 * `HTTPS://Updates.ACME.com/path/` is a domain the user pasted from their
 * browser bar. `URL` also does the IDN → punycode conversion, so an IDN arrives
 * already in its stored form.
 */
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

/** The Unicode form of a punycode name, for display alongside — never instead. */
function toUnicode(name: string): string {
  if (!name.includes('xn--')) return name
  try {
    // `Intl.DisplayNames` is not a decoder; the URL parser round-trips instead.
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
