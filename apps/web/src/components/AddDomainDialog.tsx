'use client'

import { useEffect, useRef, useState } from 'react'
import { ClaimField } from '@/components/ClaimField'
import { SubmitButton } from '@/components/SubmitButton'

const CLOSE_MS = 150

export function AddDomainDialog({
  action,
  error,
  attempted,
}: {
  action: (formData: FormData) => void | Promise<void>
  error?: string
  /** What was typed when the claim was refused, so the field comes back filled. */
  attempted?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(error !== undefined)

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
    }, CLOSE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [open])

  return (
    <>
      <button
        className="btn btn-primary"
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        <span aria-hidden="true">+</span> Add domain
      </button>

      <dialog
        className="t-modal"
        ref={dialog}
        aria-labelledby="add-domain-title"
        // Esc fires cancel; run it through the same closing transition.
        onCancel={(event) => {
          event.preventDefault()
          setOpen(false)
        }}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false)
        }}
      >
        <form className="modal-panel" action={action}>
          <div className="modal-head">
            <h2 id="add-domain-title" className="t-section">
              Add domain
            </h2>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              aria-label="Close (Esc)"
              onClick={() => {
                setOpen(false)
              }}
            >
              Esc
            </button>
          </div>

          <div className="modal-body">
            <ClaimField {...(attempted !== undefined && { initialValue: attempted })} />
            {error !== undefined && (
              <div className="callout callout-danger" role="alert">
                {error}
              </div>
            )}
          </div>

          <div className="modal-foot">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => {
                setOpen(false)
              }}
            >
              Cancel
            </button>
            <SubmitButton className="btn btn-primary" pendingLabel="Adding…">
              Add domain
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  )
}
