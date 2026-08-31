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
  // Strict mode mounts effects twice in development; without this the toast
  // arrives in duplicate.
  const shown = useRef<string | null>(null)

  const message = params.get('toast')
  const tone = params.get('tone')
  const undo = params.get('undo')
  const undoId = params.get('undoId')

  useEffect(() => {
    if (message === null) return

    const key = `${message}|${undo ?? ''}|${undoId ?? ''}`
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

    // Same entry in the history stack, so Back does not walk through toasts.
    // `pathname` is a runtime string; typed routes cannot know it is a real one.
    router.replace(pathname as Route, { scroll: false })
  }, [message, tone, undo, undoId, pathname, router, startTransition])

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
