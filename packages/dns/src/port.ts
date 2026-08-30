import type { ResolverAnswer, ResolverId, Timestamp } from '@deed/core'

/**
 * The one port every lookup goes through (D2). Real DoH and the simulated zone
 * both implement it, so the sandbox exercises the production code path rather
 * than a parallel demo mode — the engine cannot tell the difference.
 */
export type DnsPort = {
  /** One lookup, asked of every resolver independently. */
  lookup(host: string, type: RecordType, context: LookupContext): Promise<readonly ResolverAnswer[]>
}

/**
 * `TXT` carries the proof. `NS` is what pre-flight reads to know whose panel the
 * user is about to open, so the instructions can use that panel's own field
 * names (prd §5). `CNAME` and `A` exist because a host that holds one is *why*
 * a TXT cannot resolve there.
 */
export type RecordType = 'TXT' | 'NS' | 'CNAME' | 'A'

export const RECORD_TYPE_NUMBER: Record<RecordType, number> = { A: 1, NS: 2, CNAME: 5, TXT: 16 }

export type LookupContext = {
  /**
   * The clock the lookup happens on. Real DNS ignores it; the sandbox uses it to
   * run its own propagation, which is what makes `propagating` and `receding`
   * reachable on demand.
   */
  readonly now: Timestamp
  /** Per-resolver deadline. Exceeding it is our failure, never their zone's. */
  readonly timeoutMs?: number
}

/** What a transport hands back before it is classified — one shape for both. */
export type RawLookup = {
  readonly resolver: ResolverId
  readonly rcode: number
  readonly records: readonly RawRecord[]
  /** Resolver commentary, where the transport carries any. Used to spot DNSSEC. */
  readonly comment?: string
}

export type RawRecord = {
  readonly type: RecordType
  readonly ttl: number
  readonly value: string
}

/** RCODEs we act on. Everything else is treated as the zone failing to answer. */
export const RCODE = { noerror: 0, servfail: 2, nxdomain: 3, refused: 5 } as const
