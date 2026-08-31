'use client'

import { useEffect, useRef, useState } from 'react'
import { ReleaseConfirmDialog } from '@/components/ReleaseConfirmDialog'
import { SubmitButton } from '@/components/SubmitButton'

/**
 * What this row's claim can still be told to do. `live` and `closed` differ by
 * more than wording: a live claim has to be released, which frees the name for
 * anyone, while a closed one is only being tidied off a list.
 */
export type RowState = 'live' | 'closed' | 'removed'

/**
 * The per-row menu. Fixed rather than absolute because `.table-wrap` clips its
 * overflow, and a menu that opens on the last row would be cut in half.
 */
export function RowActions({
  domainId,
  name,
  state,
  requireTyping,
  release,
  remove,
  restore,
}: {
  domainId: string
  name: string
  state: RowState
  requireTyping: boolean
  release: (formData: FormData) => void | Promise<void>
  remove: (formData: FormData) => void | Promise<void>
  restore: (formData: FormData) => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [at, setAt] = useState({ top: 0, right: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const place = () => {
    const box = trigger.current?.getBoundingClientRect()
    if (box === undefined) return
    setAt({ top: box.bottom + 6, right: window.innerWidth - box.right })
  }

  useEffect(() => {
    if (!open) return

    const dismiss = (event: MouseEvent) => {
      const target = event.target as Node
      if (menu.current?.contains(target) === true) return
      if (trigger.current?.contains(target) === true) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    // Anchored to a rect taken once, so a scroll has to close it rather than
    // leave the menu floating away from its row.
    const close = () => {
      setOpen(false)
    }

    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const item = () => {
    switch (state) {
      case 'live':
        return (
          <button
            className="menu-item danger"
            type="button"
            role="menuitem"
            onClick={() => {
              // Both state changes batch into one commit, so this menu item has
              // already unmounted by the time the dialog calls showModal() —
              // and a native dialog restores focus to whatever was focused
              // then. Without this, cancelling lands you on <body>.
              trigger.current?.focus()
              setOpen(false)
              setConfirming(true)
            }}
          >
            <TrashIcon />
            Release domain
          </button>
        )
      case 'closed':
        return (
          <form action={remove}>
            <input type="hidden" name="id" value={domainId} />
            <SubmitButton className="menu-item" role="menuitem" pendingLabel="Removing…">
              <TrashIcon />
              Remove from list
            </SubmitButton>
          </form>
        )
      case 'removed':
        return (
          <form action={restore}>
            <input type="hidden" name="id" value={domainId} />
            <SubmitButton className="menu-item" role="menuitem" pendingLabel="Restoring…">
              Restore to list
            </SubmitButton>
          </form>
        )
    }
  }

  return (
    <>
      <button
        className="row-menu"
        type="button"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        onClick={() => {
          if (!open) place()
          setOpen(!open)
        }}
      >
        <span aria-hidden="true">···</span>
      </button>

      {open && (
        <div
          className="menu"
          ref={menu}
          role="menu"
          aria-label={`Actions for ${name}`}
          style={{ top: `${at.top}px`, right: `${at.right}px` }}
        >
          {item()}
        </div>
      )}

      {state === 'live' && (
        <ReleaseConfirmDialog
          action={release}
          domainId={domainId}
          name={name}
          requireTyping={requireTyping}
          open={confirming}
          onClose={() => {
            setConfirming(false)
          }}
        />
      )}
    </>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h11M6 4V2.75A.75.75 0 0 1 6.75 2h2.5a.75.75 0 0 1 .75.75V4m2 0v9.25a.75.75 0 0 1-.75.75h-6.5a.75.75 0 0 1-.75-.75V4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
