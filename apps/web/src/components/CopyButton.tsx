'use client'

import { useState } from 'react'

type State = 'idle' | 'done' | 'failed'

/**
 * The accessible name used to be a static `aria-label`, which overrides the
 * content — so the visible label flipped to "Copied" and a screen reader was
 * told nothing had changed. The qualifier lives in the content instead, and the
 * name tracks the state.
 */
export function CopyButton({
  value,
  label,
  compact = false,
}: {
  value: string
  label: string
  /** Icon-only, sitting against the value — what nine of eleven DNS panels do. */
  compact?: boolean
}) {
  const [state, setState] = useState<State>('idle')

  const settle = (next: State) => {
    setState(next)
    setTimeout(() => {
      setState('idle')
    }, 1_800)
  }

  const shown =
    state === 'done' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'

  return (
    <button
      type="button"
      title={state === 'failed' ? `Could not copy the ${label}` : `Copy ${label}`}
      className={[
        compact ? 'copy-icon' : 'btn btn-secondary btn-sm',
        'copy',
        state === 'done' ? 'done' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        // Rejects outright in a non-secure context or when permission is denied,
        // and an unhandled rejection here left the button looking untouched.
        navigator.clipboard.writeText(value).then(
          () => {
            settle('done')
          },
          () => {
            settle('failed')
          },
        )
      }}
    >
      {compact ? <Glyph state={state} /> : shown}
      <span className="visually-hidden">
        {state === 'done'
          ? ` ${label} copied`
          : state === 'failed'
            ? ` — could not copy the ${label}; select it and copy by hand`
            : ` ${label}`}
      </span>
    </button>
  )
}

function Glyph({ state }: { state: State }) {
  if (state === 'done') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="1.6"
              strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.6"
            stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.25 3.75a1.5 1.5 0 0 0-1.5-1.5h-4.5a2 2 0 0 0-2 2v4.5a1.5 1.5 0 0 0 1.5 1.5"
            stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
