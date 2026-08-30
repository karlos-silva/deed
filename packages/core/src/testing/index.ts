/** Builders for tests, shared so `packages/dns` and `apps/web` stage the same states. */
import type { AuditActor } from '../model/audit'
import type { Domain, OwnershipState } from '../model/domain'
import { type DomainId, type ResolverId, type Token, type UserId, domainId, token, userId } from '../model/ids'
import type { Observation, ResolverAnswer } from '../model/observation'
import type { RecordState } from '../model/record'
import { expectedValue } from '../recordSpec'
import { CLAIM_TTL, type Timestamp, at, days, plus } from '../time'

export const T0 = at(1_767_225_600_000) // 2026-01-01T00:00:00Z, a fixed origin
export const TOKEN_A = token('a'.repeat(52))
export const TOKEN_B = token('b'.repeat(52))
export const TOKEN_C = token('c'.repeat(52))
export const VALUE_A = expectedValue(TOKEN_A)
export const VALUE_B = expectedValue(TOKEN_B)

export const OWNER: UserId = userId('user-a')
export const OTHER: UserId = userId('user-b')
export const DOMAIN: DomainId = domainId('domain-1')

export const answered = (
  resolver: ResolverId,
  values: readonly string[],
  ttl = 300,
  cname?: string,
): ResolverAnswer =>
  cname === undefined
    ? { resolver, outcome: 'answered', values, ttl }
    : { resolver, outcome: 'answered', values, ttl, cname }

export const nxdomain = (resolver: ResolverId): ResolverAnswer => ({ resolver, outcome: 'nxdomain' })
export const nodata = (resolver: ResolverId, cname?: string): ResolverAnswer =>
  cname === undefined ? { resolver, outcome: 'nodata' } : { resolver, outcome: 'nodata', cname }
export const zoneError = (
  resolver: ResolverId,
  detail: 'servfail' | 'refused' | 'dnssec' = 'servfail',
): ResolverAnswer => ({ resolver, outcome: 'zone_error', detail })
export const ourError = (
  resolver: ResolverId,
  detail: 'timeout' | 'network' | 'throttled' = 'timeout',
): ResolverAnswer => ({ resolver, outcome: 'check_failed', detail })

export const observation = (
  answers: readonly ResolverAnswer[],
  options: { probe?: readonly ResolverAnswer[]; at?: Timestamp; actor?: AuditActor } = {},
): Observation => ({
  startedAt: options.at ?? T0,
  actor: options.actor ?? 'sweep',
  answers,
  probe: options.probe ?? [],
})

export const wildcardProbe = (value: string, ttl = 300): ResolverAnswer[] => [
  answered('cloudflare', [value], ttl),
  answered('google', [value], ttl),
  answered('adguard', [value], ttl),
]

export const pending = (claimedAt: Timestamp = T0, tok: Token = TOKEN_A): OwnershipState => ({
  status: 'pending',
  token: tok,
  claimedAt,
  expiresAt: plus(claimedAt, CLAIM_TTL),
})

export const verified = (verifiedAt: Timestamp = T0, tok: Token = TOKEN_A): OwnershipState => ({
  status: 'verified',
  token: tok,
  verifiedAt,
})

export const domain = (overrides: Partial<Domain> = {}): Domain => ({
  id: DOMAIN,
  ownerId: OWNER,
  name: 'example.com',
  isSandbox: false,
  ownership: pending(),
  record: { status: 'unchecked' } satisfies RecordState,
  supersession: null,
  lastCheckedAt: null,
  nextCheckAt: T0,
  lastChangedAt: T0,
  createdAt: T0,
  ...overrides,
})

export const laterBy = (days_: number): Timestamp => plus(T0, days(days_))
