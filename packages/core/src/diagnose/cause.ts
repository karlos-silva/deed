import type { MismatchCause, ObservedValue } from '../model/record'
import { isWellFormedValue } from '../recordSpec'

/**
 * Name the *cause*, not the symptom (prd §7). Every diagnosis has to answer
 * *does waiting help?* and *what exactly do I do?* — "invalid value" answers
 * neither, and reads as an accusation besides (prd §3).
 */

/**
 * Zero-width and non-breaking characters that survive a paste unseen, plus
 * ordinary leading and trailing space. Written as escapes on purpose: these are
 * exactly the characters nobody can see in a source file either.
 */
const INVISIBLE = /\s|\u00a0|\u200b|\u200c|\u200d|\u2060|\ufeff/g

const unquote = (value: string): string => {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(value)
  return quoted?.[2] ?? value
}

const stripInvisible = (value: string): string => value.replace(INVISIBLE, '').trim()

/** Route 53 and friends append the zone name to a value they think is a name. */
const stripApex = (value: string, domain: string): string => {
  for (const suffix of [`.${domain}.`, `.${domain}`, `${domain}.`, domain]) {
    if (value.length > suffix.length && value.endsWith(suffix)) {
      return value.slice(0, value.length - suffix.length)
    }
  }
  return value
}

/**
 * Which single quirk explains the difference between what we asked for and what
 * the zone serves. Ordered most-specific first: each step asks "does undoing
 * exactly this one provider behaviour recover the expected value?"
 */
export function diagnoseValue(observed: string, expected: string, domain: string): MismatchCause {
  if (observed === expected) return 'unknown_value' // not a mismatch; caller should not ask
  if (unquote(observed) === expected) return 'quoted_value'
  if (stripInvisible(observed) === expected) return 'whitespace'
  if (stripApex(observed, domain) === expected) return 'appended_apex'
  if (expected.startsWith(observed)) return 'truncated'
  if (isWellFormedValue(observed)) return 'wrong_token'
  return 'unknown_value'
}

/**
 * Specificity order, used when resolvers disagree about *how* the value is
 * wrong. A named provider quirk always beats "no known quirk explains it".
 */
const SPECIFICITY: readonly MismatchCause[] = [
  'quoted_value',
  'whitespace',
  'appended_apex',
  'truncated',
  'wrong_token',
  'wildcard_shadow',
  'unknown_value',
]

/** The cause a `mismatch` record carries, given every offending value seen. */
export function diagnose(
  offending: readonly ObservedValue[],
  expected: string,
  domain: string,
): MismatchCause {
  let best: MismatchCause = 'unknown_value'
  let bestRank = SPECIFICITY.length
  for (const value of offending) {
    const cause = diagnoseValue(value.value, expected, domain)
    const rank = SPECIFICITY.indexOf(cause)
    if (rank < bestRank) {
      best = cause
      bestRank = rank
    }
  }
  return best
}

/** Does waiting help? (prd §7). The whole taxonomy exists to answer this. */
export function waitingHelps(cause: MismatchCause): boolean {
  switch (cause) {
    case 'quoted_value':
    case 'appended_apex':
    case 'whitespace':
    case 'truncated':
    case 'wrong_token':
    case 'wildcard_shadow':
    case 'unknown_value':
      return false
  }
}
