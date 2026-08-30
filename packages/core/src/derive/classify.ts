import type { Token } from '../model/ids'
import type { ValueKind } from '../model/record'
import { expectedValue } from '../recordSpec'

export type Expectation = {
  readonly domain: string
  /** `null` on a terminal claim, which proves nothing. */
  readonly current: Token | null
  /** Rotated-out values still inside their bound (state-model §3). */
  readonly superseded: readonly Token[]
}

/** First match wins (state-model §3). `current` outranks a wildcard: only zone control could have published that token. */
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
