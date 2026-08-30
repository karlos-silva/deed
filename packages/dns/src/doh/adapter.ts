import { type ResolverId, parseCharacterStrings } from '@deed/core'
import type { ResolverAnswer } from '@deed/core'
import { classifyLookup, ourFailure } from '../classify'
import {
  RECORD_TYPE_NUMBER,
  type DnsPort,
  type RawLookup,
  type RawRecord,
  type RecordType,
} from '../port'

const TYPE_NAME = new Map<number, RecordType>(
  Object.entries(RECORD_TYPE_NUMBER).map(([name, number]) => [number, name as RecordType]),
)

/** Three resolvers with independent caches (D4). Quad9 is absent: it needs HTTP/2, which Node's fetch lacks (D15). */
export type Endpoint = {
  readonly resolver: ResolverId
  readonly url: (host: string, type: RecordType) => string
}

export const DOH_ENDPOINTS: readonly Endpoint[] = [
  {
    resolver: 'cloudflare',
    url: (host, type) =>
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
  },
  {
    resolver: 'google',
    url: (host, type) => `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
  },
  {
    // Unfiltered on purpose: AdGuard's default endpoint blocks names, which would read as `absent`.
    resolver: 'adguard',
    url: (host, type) =>
      `https://unfiltered.adguard-dns.com/resolve?name=${encodeURIComponent(host)}&type=${type}`,
  },
]

export const DEFAULT_TIMEOUT_MS = 4_000

export type DohOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly endpoints?: readonly Endpoint[]
  readonly timeoutMs?: number
}

export function createDohPort(options: DohOptions = {}): DnsPort {
  const endpoints = options.endpoints ?? DOH_ENDPOINTS
  const doFetch = options.fetch ?? globalThis.fetch

  return {
    async lookup(host, type, context) {
      const timeoutMs = context.timeoutMs ?? options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      return Promise.all(
        endpoints.map((endpoint) => askOne(endpoint, host, type, timeoutMs, doFetch)),
      )
    },
  }
}

async function askOne(
  endpoint: Endpoint,
  host: string,
  type: RecordType,
  timeoutMs: number,
  doFetch: typeof globalThis.fetch,
): Promise<ResolverAnswer> {
  let response: Response
  try {
    response = await doFetch(endpoint.url(host, type), {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    return ourFailure(endpoint.resolver, isTimeout(error) ? 'timeout' : 'network')
  }

  if (response.status === 429) return ourFailure(endpoint.resolver, 'throttled')
  if (!response.ok) return ourFailure(endpoint.resolver, 'network')

  try {
    return classifyLookup(fromJson(endpoint.resolver, await response.json()), type)
  } catch (error) {
    return ourFailure(endpoint.resolver, isTimeout(error) ? 'timeout' : 'network')
  }
}

const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')

/** All three agree on `Status` and `Answer`; each puts extended DNS errors somewhere different. */
type DohJson = {
  Status?: number
  Answer?: { type?: number; TTL?: number; data?: string }[]
  Comment?: string | string[]
  extended_dns_errors?: { info_code?: number; extra_text?: string }[]
  Extra?: { type?: number; data?: string }[] | null
}

export function fromJson(resolver: ResolverId, body: unknown): RawLookup {
  const json = body as DohJson
  const records: RawRecord[] = []
  for (const answer of json.Answer ?? []) {
    const ttl = answer.TTL ?? 0
    const data = answer.data ?? ''
    const type = TYPE_NAME.get(answer.type ?? -1)
    if (type === undefined) continue
    // Cloudflare and AdGuard quote TXT data, Google returns it bare; chunks join
    // with no separator (the >255-byte case a 2048-bit DKIM key produces).
    records.push({
      type,
      ttl,
      value: type === 'TXT' ? parseCharacterStrings(data) : data.replace(/\.$/, '').toLowerCase(),
    })
  }
  const comment = diagnostics(json)
  return comment === ''
    ? { resolver, rcode: json.Status ?? 0, records }
    : { resolver, rcode: json.Status ?? 0, records, comment }
}

const OPT = 41

function diagnostics(json: DohJson): string {
  const parts: string[] = []
  if (Array.isArray(json.Comment)) parts.push(...json.Comment)
  else if (json.Comment !== undefined) parts.push(json.Comment)
  for (const ede of json.extended_dns_errors ?? []) {
    parts.push(`EDE(${ede.info_code ?? ''}) ${ede.extra_text ?? ''}`)
  }
  for (const extra of json.Extra ?? []) {
    if (extra.type === OPT && extra.data !== undefined) parts.push(extra.data)
  }
  return parts.join(' ').trim()
}
