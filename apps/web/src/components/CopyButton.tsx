'use client'

import { useState } from 'react'

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
          setTimeout(() => {
            setCopied(false)
          }, 1_400)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
