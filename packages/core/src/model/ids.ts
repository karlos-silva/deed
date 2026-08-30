/** Branded identifiers — a UserId is never accidentally a DomainId. */
export type DomainId = string & { readonly __brand: 'DomainId' }
export type UserId = string & { readonly __brand: 'UserId' }

/**
 * The secret itself — 32 random bytes, base32-encoded lowercase without
 * padding, 52 characters (prd §4). The value published in DNS is
 * `deed-challenge=<token>`; see `recordSpec.ts`.
 */
export type Token = string & { readonly __brand: 'Token' }

export const domainId = (s: string): DomainId => s as DomainId
export const userId = (s: string): UserId => s as UserId
export const token = (s: string): Token => s as Token

/** The three DoH resolvers of D4, as amended by D15. The sandbox simulates the same three. */
export type ResolverId = 'cloudflare' | 'google' | 'adguard'
export const RESOLVERS: readonly ResolverId[] = ['cloudflare', 'google', 'adguard']
