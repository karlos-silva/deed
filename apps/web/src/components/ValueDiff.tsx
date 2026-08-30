import { collapse, diffValues, type DiffRun } from '@deed/core'

/**
 * Character-level, so a pair of quotes is marked as two characters rather than
 * as "the whole value is wrong" (D8). Truncation is mid-string, head and tail:
 * cutting only the end would hide half the defects — a quote shows up at the
 * start, whitespace and an appended apex at the end.
 */
export function ValueDiff({ expected, observed }: { expected: string; observed: string }) {
  const diff = diffValues(expected, observed)

  return (
    <div className="diff">
      <div className="diff-line diff-expected">
        <span className="sigil">expected</span>
        <span>
          <Runs runs={collapse(diff.expected)} />
        </span>
      </div>
      <div className="diff-line diff-found">
        <span className="sigil">in your DNS</span>
        <span>
          <Runs runs={collapse(diff.observed)} />
        </span>
      </div>
    </div>
  )
}

function Runs({ runs }: { runs: DiffRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        switch (run.kind) {
          case 'changed':
            return <mark key={index}>{visible(run.text)}</mark>
          case 'elided':
            return (
              <span key={index}>
                {run.head}
                <span className="ell" title={`${run.hidden} identical characters`}>
                  …
                </span>
                {run.tail}
              </span>
            )
          case 'same':
            return <span key={index}>{visible(run.text)}</span>
        }
      })}
    </>
  )
}

/**
 * A defect nobody can see is a defect nobody can fix. Whitespace and zero-width
 * characters get a printable stand-in inside the diff, and only there.
 */
const visible = (text: string): string =>
  text
    .replace(/ /g, '␣')
    .replace(/\t/g, '⇥')
    .replace(/[​‌‍⁠﻿]/g, '␀')
    .replace(/ /g, '␠')
