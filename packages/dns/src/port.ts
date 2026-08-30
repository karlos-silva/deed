import type { ResolverAnswer, ResolverId, Timestamp } from '@deed/core'

export type DnsPort = {
  lookup(host: string, type: RecordType, context: LookupContext): Promise<readonly ResolverAnswer[]>
}

/** `NS` tells pre-flight whose DNS panel the user is about to open (prd §5). */
export type RecordType = 'TXT' | 'NS' | 'CNAME' | 'A'

export const RECORD_TYPE_NUMBER: Record<RecordType, number> = { A: 1, NS: 2, CNAME: 5, TXT: 16 }

export type LookupContext = {
  /** Real DNS ignores this; the sandbox runs its own propagation off it. */
  readonly now: Timestamp
  readonly timeoutMs?: number
}

export type RawLookup = {
  readonly resolver: ResolverId
  readonly rcode: number
  readonly records: readonly RawRecord[]
  /** Resolver diagnostics, where the transport carries any; scanned for DNSSEC. */
  readonly comment?: string
}

export type RawRecord = {
  readonly type: RecordType
  readonly ttl: number
  readonly value: string
}

/** RCODEs we act on. Everything else is treated as the zone failing to answer. */
export const RCODE = { noerror: 0, servfail: 2, nxdomain: 3, refused: 5 } as const
