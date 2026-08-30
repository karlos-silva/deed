'use client'

import { useState } from 'react'

/**
 * Host and value copy separately, because most DNS panels have two fields
 * (prd §6.2) — and because "use the copy button" is the fix for a whole row of
 * the failure taxonomy.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      type="button"
      className={`btn btn-secondary btn-sm ${copied ? 'copy' : ''}`}
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1_400)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
