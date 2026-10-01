import {
  RESOLVERS,
  type Domain,
  type OwnershipState,
  type RecordState,
  at,
  days,
  domainId,
  expectedValue,
  plus,
  token,
  userId,
} from '@deed/core'
import type { RegisterEntry } from '@/components/Register'

/**
 * The made-up claims the design gallery and the page previews draw from — every
 * state the product can render, with no sign-in and no DNS. Development only (S8).
 */
export const T0 = at(1_767_225_600_000)
export const TOKEN = token('uyxawsmda4slfuoy5kqsxemuu2vfgzuzdmb6e2np2dzscadiqa3q')
export const VALUE = expectedValue(TOKEN)
export const ttl = {
  perResolver: [
    { resolver: 'cloudflare' as const, ttl: 300 },
    { resolver: 'google' as const, ttl: 14_400 },
  ],
  max: 14_400,
}

export const domain = (record: RecordState, ownership?: OwnershipState): Domain => ({
  id: domainId('d'),
  ownerId: userId('u'),
  name: 'demo.karlos.dev',
  isSandbox: false,
  ownership: ownership ?? {
    status: 'pending',
    token: TOKEN,
    claimedAt: T0,
    expiresAt: plus(T0, days(14)),
  },
  record,
  supersession: null,
  lastCheckedAt: T0,
  nextCheckAt: plus(T0, days(1)),
  lastChangedAt: T0,
  createdAt: T0,
})

export const RECORDS: [string, RecordState][] = [
  ['unchecked', { status: 'unchecked' }],
  ['absent · nxdomain', { status: 'absent', kind: 'nxdomain' }],
  ['absent · cname at host', { status: 'absent', kind: 'nodata', cname: 'shop.myshopify.com' }],
  [
    'propagating · arriving',
    { status: 'propagating', direction: 'arriving', seenBy: ['cloudflare'], staleAt: [], ttl },
  ],
  [
    'propagating · receding',
    { status: 'propagating', direction: 'receding', seenBy: ['cloudflare'], staleAt: [], ttl },
  ],
  [
    'propagating · stale token',
    { status: 'propagating', direction: 'arriving', seenBy: [], staleAt: ['google', 'adguard'], ttl },
  ],
  ['verified', { status: 'verified', seenBy: [...RESOLVERS], ttl }],
  [
    'zone_error · dnssec',
    { status: 'zone_error', errors: [{ resolver: 'cloudflare', side: 'zone', detail: 'dnssec' }] },
  ],
  [
    'check_failed',
    { status: 'check_failed', errors: [{ resolver: 'google', side: 'ours', detail: 'timeout' }] },
  ],
  ...(
    [
      'quoted_value',
      'appended_apex',
      'whitespace',
      'truncated',
      'wrong_token',
      'wildcard_shadow',
      'unknown_value',
    ] as const
  ).map(
    (cause): [string, RecordState] => [
      `mismatch · ${cause}`,
      {
        status: 'mismatch',
        cause,
        observed: [
          { resolver: 'cloudflare', value: `"${VALUE}"`, kind: 'unknown' },
          { resolver: 'google', value: VALUE, kind: 'current' },
        ],
        correcting: null,
      },
    ],
  ),
  [
    'mismatch · correcting',
    {
      status: 'mismatch',
      cause: 'quoted_value',
      observed: [
        { resolver: 'cloudflare', value: `"${VALUE}"`, kind: 'unknown' },
        { resolver: 'google', value: VALUE, kind: 'current' },
        { resolver: 'adguard', value: VALUE, kind: 'current' },
      ],
      correcting: { seenBy: ['google', 'adguard'], clearingAt: ['cloudflare'], ttl },
    },
  ],
]

export const CLAIMS: [string, OwnershipState][] = [
  ['pending', { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, days(14)) }],
  ['verified', { status: 'verified', token: TOKEN, verifiedAt: T0 }],
  [
    'degraded',
    {
      status: 'degraded',
      token: TOKEN,
      verifiedAt: T0,
      degradedAt: T0,
      revokesAt: plus(T0, days(7)),
      cause: 'record_missing',
    },
  ],
  ['expired', { status: 'expired', claimedAt: T0 }],
  ['revoked · grace_expired', { status: 'revoked', reason: 'grace_expired' }],
  ['revoked · released_by_owner', { status: 'revoked', reason: 'released_by_owner' }],
  ['revoked · claimed_by_other', { status: 'revoked', reason: 'claimed_by_other' }],
]

/** A register with one claim in every standing, for the list's gallery and preview. */
export const ENTRIES: RegisterEntry[] = [
  {
    id: 'acme',
    name: 'acme.com',
    ownership: { status: 'pending', token: TOKEN, claimedAt: T0, expiresAt: plus(T0, days(14)) },
    isSandbox: false,
    lastCheckedAt: T0 - 60_000,
    createdAt: T0 - 3 * 2_592_000_000,
  },
  {
    id: 'updates',
    name: 'updates.acme.com',
    ownership: { status: 'verified', token: TOKEN, verifiedAt: T0 },
    isSandbox: false,
    lastCheckedAt: T0 - 4 * 60_000,
    createdAt: T0 - 2 * 2_592_000_000,
  },
  {
    id: 'shop',
    name: 'shop.acme.co.uk',
    ownership: {
      status: 'degraded',
      token: TOKEN,
      verifiedAt: T0,
      degradedAt: T0,
      revokesAt: plus(T0, days(7)),
      cause: 'record_missing',
    },
    isSandbox: false,
    lastCheckedAt: T0 - 2 * 3_600_000,
    createdAt: T0 - 6 * 86_400_000,
  },
  {
    id: 'sandbox',
    name: 'acme.test',
    ownership: { status: 'verified', token: TOKEN, verifiedAt: T0 },
    isSandbox: true,
    lastCheckedAt: T0,
    createdAt: T0 - 3_600_000,
  },
  {
    id: 'lapsed',
    name: 'lapsed.com',
    ownership: { status: 'revoked', reason: 'released_by_owner' },
    isSandbox: false,
    lastCheckedAt: null,
    createdAt: T0 - 14 * 86_400_000,
  },
]

