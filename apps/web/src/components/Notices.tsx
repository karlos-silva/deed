'use client'

import { useEffect, useRef, useTransition } from 'react'
import type { Route } from 'next'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Toaster, toast } from 'sonner'
import { removeFromList, restoreToList } from '@/app/domains/actions'

/**
 * A server action's only channel to the next render is the URL, so what to say
 * arrives as a query parameter. The parameter is then stripped, which is the
 * whole point: the callout this replaces lived in the URL, so it sat on the page
 * until you navigated away and came back if you reloaded.
 *
 * Undo is offered only where the action can actually be taken back. Removing a
 * claim from the list can; releasing one cannot, because the name returns to the
 * pool the moment it commits.
 */
export function Notices() {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const [, startTransition] = useTransition()
  const shown = useRef<string | null>(null)

  const message = params.get('toast')
  const tone = params.get('tone')
  const undo = params.get('undo')
  const undoId = params.get('undoId')
  // Minted per action, so removing the same domain twice is two toasts rather
  // than one. Keying on the message would swallow the second, because the copy
  // is byte-identical.
  const id = params.get('tid')
  // Not shown as a toast — the banner blooms instead. Read here only so the URL
  // is cleaned on the first render.
  const just = params.get('just')

  useEffect(() => {
    if (message === null && just === null) return

    // Cleaned first and unconditionally: an error routed here by some other path
    // used to sit in the address bar forever and re-fire on reload.
    router.replace(pathname as Route, { scroll: false })

    if (message === null) return

    // Strict mode mounts effects twice in development. The nonce is what makes
    // two identical messages two toasts; the message is the fallback for any
    // redirect that predates it.
    const key = id ?? message
    if (shown.current === key) return
    shown.current = key

    const options =
      undo !== null && undoId !== null
        ? {
            action: {
              label: 'Undo',
              onClick: () => {
                const form = new FormData()
                form.set('id', undoId)
                startTransition(() => {
                  void (undo === 'restore' ? restoreToList(form) : removeFromList(form))
                })
              },
            },
          }
        : {}

    if (tone === 'danger') toast.error(message, options)
    else if (tone === 'ok') toast.success(message, options)
    else toast(message, options)

  }, [message, tone, undo, undoId, id, just, pathname, router, startTransition])

  return (
    <Toaster
      position="bottom-right"
      offset={20}
      gap={10}
      duration={5000}
      visibleToasts={3}
      // Unstyled: the default chrome is light and rounded in a way that reads as
      // a different product. Everything below comes from the app's own tokens.
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: 'toast',
          title: 'toast-title',
          actionButton: 'toast-action',
          closeButton: 'toast-close',
        },
      }}
    />
  )
}
