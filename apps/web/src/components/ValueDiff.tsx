import { collapse, diffValues, type DiffRun } from '@deed/core'

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

// Whitespace and zero-width characters get a printable stand-in — inside the diff only.
const INVISIBLE = /\u200b|\u200c|\u200d|\u2060|\ufeff/g

const visible = (text: string): string =>
  text.replace(/ /g, '␣').replace(/\t/g, '⇥').replace(/\u00a0/g, '␠').replace(INVISIBLE, '␀')
