import type { MismatchCause } from './model/record'

/** Who runs this zone, and what their panel calls things — read from NS records before a token is issued (prd §3.2). */
export type ProviderId =
  | 'cloudflare'
  | 'route53'
  | 'google'
  | 'squarespace'
  | 'godaddy'
  | 'namecheap'
  | 'azure'
  | 'vercel'
  | 'dnsimple'
  | 'ns1'

export type Provider = {
  readonly id: ProviderId
  readonly name: string
  readonly hostLabel: string
  readonly valueLabel: string
  /** Whether the panel wants the host relative to the zone rather than absolute. */
  readonly relativeHost: boolean
  /** Only quirks we will name in front of the user: a warning about a quirk a provider lacks is worse than none. */
  readonly quirks: readonly MismatchCause[]
}

type Signature = { readonly match: readonly string[]; readonly provider: Provider }

const PROVIDERS: readonly Signature[] = [
  {
    match: ['ns.cloudflare.com'],
    provider: {
      id: 'cloudflare',
      name: 'Cloudflare',
      hostLabel: 'Name',
      valueLabel: 'Content',
      relativeHost: true,
      quirks: ['quoted_value'],
    },
  },
  {
    match: ['awsdns-'],
    provider: {
      id: 'route53',
      name: 'Route 53',
      hostLabel: 'Record name',
      valueLabel: 'Value',
      relativeHost: false,
      quirks: ['appended_apex'],
    },
  },
  {
    match: ['googledomains.com', 'google.com'],
    provider: {
      id: 'google',
      name: 'Google Cloud DNS',
      hostLabel: 'DNS name',
      valueLabel: 'TXT data',
      relativeHost: false,
      // Cloud DNS stores TXT as quoted character-strings, so a value pasted with quotes ends up quoted twice.
      quirks: ['quoted_value'],
    },
  },
  {
    match: ['squarespacedns.com'],
    provider: {
      id: 'squarespace',
      name: 'Squarespace',
      hostLabel: 'Host',
      valueLabel: 'Data',
      relativeHost: true,
      quirks: [],
    },
  },
  {
    match: ['domaincontrol.com'],
    provider: {
      id: 'godaddy',
      name: 'GoDaddy',
      hostLabel: 'Name',
      valueLabel: 'Value',
      relativeHost: true,
      quirks: [],
    },
  },
  {
    match: ['registrar-servers.com'],
    provider: {
      id: 'namecheap',
      name: 'Namecheap',
      hostLabel: 'Host',
      valueLabel: 'Value',
      relativeHost: true,
      quirks: [],
    },
  },
  {
    match: ['azure-dns'],
    provider: {
      id: 'azure',
      name: 'Azure DNS',
      hostLabel: 'Name',
      valueLabel: 'Value',
      relativeHost: true,
      quirks: [],
    },
  },
  {
    match: ['vercel-dns.com'],
    provider: {
      id: 'vercel',
      name: 'Vercel',
      hostLabel: 'Name',
      valueLabel: 'Value',
      relativeHost: true,
      quirks: [],
    },
  },
  {
    match: ['dnsimple.com'],
    provider: {
      id: 'dnsimple',
      name: 'DNSimple',
      hostLabel: 'Name',
      valueLabel: 'Content',
      relativeHost: true,
      quirks: [],
    },
  },
  {
    match: ['nsone.net'],
    provider: {
      id: 'ns1',
      name: 'NS1',
      hostLabel: 'Name',
      valueLabel: 'Answer',
      relativeHost: true,
      quirks: [],
    },
  },
]

export function providerFromNameservers(nameservers: readonly string[]): Provider | null {
  const lowered = nameservers.map((ns) => ns.replace(/\.$/, '').toLowerCase())
  for (const { match, provider } of PROVIDERS) {
    if (lowered.some((ns) => match.some((needle) => ns.includes(needle)))) return provider
  }
  return null
}

/** Every finding is a warning: pre-flight never blocks a claim (S5). */
export type PreflightWarning =
  | { readonly kind: 'provider_quirk'; readonly provider: Provider; readonly cause: MismatchCause }
  | { readonly kind: 'wildcard'; readonly value: string }
  | { readonly kind: 'cname_at_host'; readonly target: string }
  | { readonly kind: 'domain_unregistered' }
  | { readonly kind: 'zone_failing' }

export type PreflightFindings = {
  readonly registered: boolean
  readonly provider: Provider | null
  /** A value the control probe returned, meaning a wildcard answers here. */
  readonly wildcard: string | null
  readonly cnameAtHost: string | null
  readonly zoneFailing: boolean
}

export function preflightWarnings(findings: PreflightFindings): PreflightWarning[] {
  const warnings: PreflightWarning[] = []

  if (!findings.registered) warnings.push({ kind: 'domain_unregistered' })
  if (findings.zoneFailing) warnings.push({ kind: 'zone_failing' })

  if (findings.provider !== null) {
    for (const cause of findings.provider.quirks) {
      warnings.push({ kind: 'provider_quirk', provider: findings.provider, cause })
    }
  }

  if (findings.cnameAtHost !== null) {
    warnings.push({ kind: 'cname_at_host', target: findings.cnameAtHost })
  }
  if (findings.wildcard !== null) warnings.push({ kind: 'wildcard', value: findings.wildcard })

  return warnings
}
