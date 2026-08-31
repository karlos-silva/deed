'use client'

import { useEffect, useRef, useState } from 'react'
import { SubmitButton } from '@/components/SubmitButton'

const CLOSE_MS = 150

/**
 * Releasing is the one action here that cannot be undone by the person taking
 * it: the moment the name is back in the pool, somebody else can prove it. A
 * proved claim asks for the name to be typed back; a pending one does not,
 * because nothing is at stake but the row.
 *
 * Controlled, with no trigger of its own, because it is opened from a button on
 * the detail page and from a row menu in the list.
 */
export function ReleaseConfirmDialog({
  action,
  domainId,
  name,
  requireTyping,
  open,
  onClose,
}: {
  action: (formData: FormData) => void | Promise<void>
  domainId: string
  name: string
  requireTyping: boolean
  open: boolean
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    const node = dialog.current
    if (node === null) return

    if (open) {
      if (!node.open) node.showModal()
      // Force the closed styles to compute before the open class lands, so the
      // transition has a start value. A rAF would do it too, but it never fires
      // in a background tab, which would leave the dialog open at opacity 0.
      void node.offsetWidth
      node.classList.add('is-open')
      return
    }

    if (!node.open) return
    node.classList.remove('is-open')
    node.classList.add('is-closing')
    const timer = setTimeout(() => {
      node.classList.remove('is-closing')
      node.close()
      setTyped('')
    }, CLOSE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [open])

  return (
    <dialog
      className="t-modal"
      ref={dialog}
      aria-labelledby={`release-title-${domainId}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose()
      }}
    >
      <form className="modal-panel" action={action}>
        <input type="hidden" name="id" value={domainId} />

        <div className="modal-head">
          <h2 id={`release-title-${domainId}`} className="t-section">
            Release {name}?
          </h2>
          <button className="btn btn-ghost btn-sm" type="button" aria-label="Close" onClick={onClose}>
            Esc
          </button>
        </div>

        <div className="modal-body stack-3">
          <ul className="plain-list t-small">
            <li>
              The name goes back to the pool. Anyone can prove it from that moment — including
              someone else, before you change your mind.
            </li>
            <li>This token stops proving anything. Claiming again issues a new one.</li>
            <li>
              The domain leaves your list. Everything it went through stays readable under Removed.
            </li>
          </ul>

          {requireTyping && (
            <label className="field">
              <span className="t-label">Type {name} to confirm</span>
              <input
                className="input t-mono"
                name="confirm"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value)
                }}
              />
            </label>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <SubmitButton
            className="btn btn-danger"
            pendingLabel="Releasing…"
            disabled={requireTyping && typed !== name}
          >
            Release
          </SubmitButton>
        </div>
      </form>
    </dialog>
  )
}
