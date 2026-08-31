'use client'

import { useState } from 'react'

type State = 'idle' | 'done' | 'failed'

/**
 * The accessible name used to be a static `aria-label`, which overrides the
 * content — so the visible label flipped to "Copied" and a screen reader was
 * told nothing had changed. The qualifier lives in the content instead, and the
 * name tracks the state.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<State>('idle')

  const settle = (next: State) => {
    setState(next)
    setTimeout(() => {
      setState('idle')
    }, 1_800)
  }

  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm copy ${state === 'done' ? 'done' : ''}`}
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
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Select it' : 'Copy'}
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
