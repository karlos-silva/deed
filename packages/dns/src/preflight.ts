import {
  type PreflightWarning,
  type Provider,
  type Timestamp,
  challengeHost,
  preflightWarnings,
  providerFromNameservers,
} from '@deed/core'
import type { DnsPort, LookupContext } from './port'

/** What is known about a zone before a token is issued (prd §3.2). It never blocks — everything here is a warning. */
export type Preflight = {
  readonly name: string
  readonly registered: boolean
  readonly nameservers: readonly string[]
  readonly provider: Provider | null
  readonly wildcard: string | null
  readonly cnameAtHost: string | null
  readonly zoneFailing: boolean
  readonly warnings: readonly PreflightWarning[]
}

export type PreflightOptions = {
  readonly now: Timestamp
  readonly probeLabel: string
  readonly timeoutMs?: number
}

export async function preflight(
  port: DnsPort,
  name: string,
  options: PreflightOptions,
): Promise<Preflight> {
  const context: LookupContext =
    options.timeoutMs === undefined
      ? { now: options.now }
      : { now: options.now, timeoutMs: options.timeoutMs }

  const host = challengeHost(name)
  const [ns, probe, atHost] = await Promise.all([
    port.lookup(name, 'NS', context),
    port.lookup(`${options.probeLabel}.${name}`, 'TXT', context),
    port.lookup(host, 'CNAME', context),
  ])

  // No NS anywhere means nobody delegated the name; NODATA still counts as registered (state-model §3).
  const nameservers = [...new Set(ns.flatMap((a) => (a.outcome === 'answered' ? a.values : [])))]
  const registered = nameservers.length > 0 || ns.some((a) => a.outcome === 'nodata')
  const zoneFailing = ns.length > 0 && ns.every((a) => a.outcome === 'zone_error')

  // Nobody creates a record at a random label: an answer here is a wildcard.
  const wildcard =
    probe.flatMap((a) => (a.outcome === 'answered' ? a.values : []))[0] ?? null

  const cnameAtHost =
    atHost.flatMap((a) => (a.outcome === 'answered' ? a.values : []))[0] ??
    atHost.map((a) => ('cname' in a ? a.cname : undefined)).find((c) => c !== undefined) ??
    null

  const provider = providerFromNameservers(nameservers)
  const findings = { registered, provider, wildcard, cnameAtHost, zoneFailing }

  return { name, nameservers, ...findings, warnings: preflightWarnings(findings) }
}
