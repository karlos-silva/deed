'use client'

import { useFormStatus } from 'react-dom'

/**
 * A submit that admits it is working. Several of these actions perform live DNS
 * lookups across three resolvers, so the gap between the click and the new page
 * is real — and until now nothing on screen acknowledged the click at all.
 *
 * The label changes rather than being replaced by a bare spinner: "Checking…"
 * says what is happening, where a spinner only says that something is.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className = 'btn btn-secondary btn-sm',
  disabled = false,
  role,
}: {
  children: React.ReactNode
  pendingLabel?: string
  className?: string
  disabled?: boolean
  role?: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      className={className}
      type="submit"
      disabled={pending || disabled}
      data-pending={pending}
      {...(role !== undefined && { role })}
    >
      {pending && <Spinner />}
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  )
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}
