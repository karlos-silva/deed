/**
 * `packages/dns` — the `DnsPort` and its two adapters (D2, D4).
 *
 * Real DoH and the simulated zone implement the same port, so every failure in
 * the taxonomy is reachable on demand without hand-breaking real DNS, and the
 * sandbox exercises the production code path rather than a parallel demo mode.
 */
export * from './port'
export * from './classify'
export * from './observe'
export * from './route'
export * from './doh/adapter'
export * from './sandbox/zone'
export * from './sandbox/adapter'
