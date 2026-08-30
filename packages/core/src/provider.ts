import type { MismatchCause } from './model/record'

/**
 * Who runs this zone, and what their panel calls things.
 *
 * "Diagnose before the user can make the mistake" (prd §3.2): we can read their
 * NS records the moment they type the domain, so the instructions can use the
 * field names they are actually looking at, and the warning about the quirk that
 * panel is known for can arrive *before* the token is issued rather than after
 * it has already been mangled.
 *
 * Field labels are what the panel calls the fields. Getting one wrong sends
 * somebody hunting for a control that does not exist, so an unrecognised
 * provider gets generic labels rather than a guess.
 */
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
  /** What this panel calls the field holding the record's name. */
  readonly hostLabel: string
  /** What it calls the field holding the record's data. */
  readonly valueLabel: string
  /** Whether the panel wants the host relative to the zone rather than absolute. */
  readonly relativeHost: boolean
  /**
   * What this panel is known to do to a value. Only behaviours we are prepared
   * to name in front of the user — a warning about a quirk a provider does not
   * have is worse than no warning at all.
   */
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
      // Cloud DNS stores TXT data as quoted character-strings, so a value
      // pasted with its own quotes ends up quoted twice.
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

/** Generic labels, for a zone we do not recognise. Never a guess. */
export const UNKNOWN_PROVIDER = {
  hostLabel: 'Host',
  valueLabel: 'Value',
  relativeHost: true,
} as const

export function providerFromNameservers(nameservers: readonly string[]): Provider | null {
  const lowered = nameservers.map((ns) => ns.replace(/\.$/, '').toLowerCase())
  for (const { match, provider } of PROVIDERS) {
    if (lowered.some((ns) => match.some((needle) => ns.includes(needle)))) return provider
  }
  return null
}

/**
 * What pre-flight found worth saying before a token is issued. Every one is a
 * warning: pre-flight never blocks a claim (S5). We can be wrong about a zone;
 * the user cannot be wrong about owning it.
 */
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

/** The findings, turned into the things worth telling somebody. Pure. */
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
