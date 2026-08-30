/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-misused-spread -- the LCS walk indexes a table it just sized; spreading a string yields code points, the right unit for a diff shown to a human. */

/** Character-level diff (D8). Affix-only diffing marks the whole string when a provider prepends a quote. */

export type Marked = { readonly char: string; readonly changed: boolean }

export type ValueDiff = {
  readonly expected: readonly Marked[]
  readonly observed: readonly Marked[]
}

/** Above this, the quadratic table is not worth it and nothing is that long. */
const LCS_LIMIT = 2_048

export function diffValues(expected: string, observed: string): ValueDiff {
  const a = [...expected]
  const b = [...observed]
  if (a.length > LCS_LIMIT || b.length > LCS_LIMIT) return affixDiff(a, b)

  const n = a.length
  const m = b.length
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!
    const next = dp[i + 1]!
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!)
    }
  }

  const A: Marked[] = []
  const B: Marked[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      A.push({ char: a[i]!, changed: false })
      B.push({ char: b[j]!, changed: false })
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      A.push({ char: a[i]!, changed: true })
      i++
    } else {
      B.push({ char: b[j]!, changed: true })
      j++
    }
  }
  while (i < n) A.push({ char: a[i++]!, changed: true })
  while (j < m) B.push({ char: b[j++]!, changed: true })
  return { expected: A, observed: B }
}

function affixDiff(a: readonly string[], b: readonly string[]): ValueDiff {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const mark = (chars: readonly string[]): Marked[] =>
    chars.map((char, index) => ({
      char,
      changed: index >= head && index < chars.length - tail,
    }))
  return { expected: mark(a), observed: mark(b) }
}

export type DiffRun =
  | { readonly kind: 'same'; readonly text: string }
  | { readonly kind: 'changed'; readonly text: string }
  | { readonly kind: 'elided'; readonly head: string; readonly tail: string; readonly hidden: number }

/** Truncate in the *middle*: a quote shows at the start, whitespace and an appended apex at the end (D8). */
export function collapse(marked: readonly Marked[], threshold = 28, keep = 12): DiffRun[] {
  const runs: { changed: boolean; text: string }[] = []
  for (const { char, changed } of marked) {
    const last = runs.at(-1)
    if (last && last.changed === changed) last.text += char
    else runs.push({ changed, text: char })
  }
  return runs.map((run): DiffRun => {
    if (run.changed) return { kind: 'changed', text: run.text }
    if (run.text.length > threshold) {
      return {
        kind: 'elided',
        head: run.text.slice(0, keep),
        tail: run.text.slice(-keep),
        hidden: run.text.length - keep * 2,
      }
    }
    return { kind: 'same', text: run.text }
  })
}
