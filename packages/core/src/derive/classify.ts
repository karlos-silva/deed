import type { Token } from '../model/ids'
import type { ValueKind } from '../model/record'
import { expectedValue } from '../recordSpec'

/** What this check knows before it looks at a single answer. */
export type Expectation = {
  /** The claimed name — punycode, lowercased, no trailing dot. */
  readonly domain: string
  /** The value that proves the claim; `null` on a terminal claim, which proves nothing. */
  readonly current: Token | null
  /** Rotated-out values still inside their bound (state-model §3). */
  readonly superseded: readonly Token[]
}

/**
 * Every observed value is classified before any precedence rule runs, first
 * match wins (state-model §3).
 *
 * `current` is proof regardless of wildcards: the token is high-entropy and
 * scoped, so publishing it *anywhere* in the zone required control of the zone.
 * A wildcard cannot fabricate it.
 */
export function classifyValue(
  value: string,
  expectation: Expectation,
  wildcardServed: ReadonlySet<string>,
): ValueKind {
  if (expectation.current !== null && value === expectedValue(expectation.current)) return 'current'
  for (const previous of expectation.superseded) {
    if (value === expectedValue(previous)) return 'superseded'
  }
  if (wildcardServed.has(value)) return 'wildcard_served'
  return 'unknown'
}
