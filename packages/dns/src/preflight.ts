import {
  type PreflightWarning,
  type Provider,
  type Timestamp,
  challengeHost,
  preflightWarnings,
  providerFromNameservers,
} from '@deed/core'
import type { DnsPort, LookupContext } from './port'

/**
 * Everything worth knowing about a zone *before* a token is issued (prd §3.2).
 *
 * Four questions, asked at once: does the name resolve at all, whose panel is
 * the user about to open, does a wildcard answer here, and is the challenge host
 * already occupied by a CNAME. Each of them prevents a failure rather than
 * explaining one afterwards.
 *
 * It never blocks. We can be wrong about a zone — a resolver can time out, an NS
 * set can be unrecognised — and the user cannot be wrong about owning their own
 * domain. Everything here is a warning.
 */
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
  /** The same unguessable sibling label the check uses (state-model §3). */
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

  // A name with no NS anywhere is a name nobody has delegated — which at check
  // time is indistinguishable from a missing record, and right now is not
  // (state-model §3, `domain_unregistered`).
  const nameservers = [...new Set(ns.flatMap((a) => (a.outcome === 'answered' ? a.values : [])))]
  const registered = nameservers.length > 0 || ns.some((a) => a.outcome === 'nodata')
  const zoneFailing = ns.length > 0 && ns.every((a) => a.outcome === 'zone_error')

  // Anything the probe returns is being served by a wildcard: nobody created a
  // record at a random label.
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
