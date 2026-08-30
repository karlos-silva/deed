import type { Token } from './model/ids'

/**
 * `_deed-challenge.example.com.  TXT  "deed-challenge=<token>"` (prd §4).
 * The label names the verifier, the way `_acme-challenge` does (D13).
 */
export const CHALLENGE_LABEL = '_deed-challenge'
export const VALUE_PREFIX = 'deed-challenge='

/** 32 random bytes, base32-encoded lowercase without padding — 52 characters. */
export const TOKEN_LENGTH = 52
const TOKEN_SHAPE = new RegExp(`^[a-z2-7]{${TOKEN_LENGTH}}$`)
const VALUE_SHAPE = new RegExp(`^${VALUE_PREFIX}[a-z2-7]{${TOKEN_LENGTH}}$`)

export const challengeHost = (name: string): string => `${CHALLENGE_LABEL}.${name}`

export const expectedValue = (token: Token): string => `${VALUE_PREFIX}${token}`

export const isWellFormedToken = (candidate: string): boolean => TOKEN_SHAPE.test(candidate)

export const isWellFormedValue = (candidate: string): boolean => VALUE_SHAPE.test(candidate)
