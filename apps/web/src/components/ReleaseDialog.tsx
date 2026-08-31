'use client'

import { useState } from 'react'
import { ReleaseConfirmDialog } from '@/components/ReleaseConfirmDialog'

/** The detail page's own Release button, with the confirmation behind it. */
export function ReleaseDialog({
  action,
  domainId,
  name,
  requireTyping,
}: {
  action: (formData: FormData) => void | Promise<void>
  domainId: string
  name: string
  requireTyping: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className="btn btn-danger btn-sm"
        type="button"
        onClick={() => {
          setOpen(true)
        }}
      >
        Release
      </button>

      <ReleaseConfirmDialog
        action={action}
        domainId={domainId}
        name={name}
        requireTyping={requireTyping}
        open={open}
        onClose={() => {
          setOpen(false)
        }}
      />
    </>
  )
}
