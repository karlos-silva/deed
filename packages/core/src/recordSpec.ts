import type { Token } from './model/ids'

/**
 * One record, one meaning, one failure mode (prd §4):
 *
 *     _deed-challenge.example.com.  TXT  "deed-challenge=<token>"
 *
 * The label names the verifier, the way `_acme-challenge` does — someone
 * auditing their zone can tell whose proof this is without asking (D13).
 */
export const CHALLENGE_LABEL = '_deed-challenge'
export const VALUE_PREFIX = 'deed-challenge='

/** 32 random bytes, base32-encoded lowercase without padding — 52 characters. */
export const TOKEN_LENGTH = 52
const TOKEN_SHAPE = new RegExp(`^[a-z2-7]{${TOKEN_LENGTH}}$`)
const VALUE_SHAPE = new RegExp(`^${VALUE_PREFIX}[a-z2-7]{${TOKEN_LENGTH}}$`)

/** The host to query for a claim on `name`. */
export const challengeHost = (name: string): string => `${CHALLENGE_LABEL}.${name}`

/** The full RDATA the user publishes — what every observed value is compared to. */
export const expectedValue = (token: Token): string => `${VALUE_PREFIX}${token}`

export const isWellFormedToken = (candidate: string): boolean => TOKEN_SHAPE.test(candidate)

/** A value shaped like one of ours, but not the one we expect here. */
export const isWellFormedValue = (candidate: string): boolean => VALUE_SHAPE.test(candidate)
