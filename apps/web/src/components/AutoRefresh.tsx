'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * A pending claim is the one state the product asks you to sit in, and it was
 * the one state that never moved: the page printed "Next automatic check due
 * now" at render time and then froze until a manual reload. The sweep was doing
 * the work; nothing was telling the page.
 *
 * Refreshing rather than polling an endpoint, because the server component
 * already knows how to compute all of this — and because `revalidateIfDue` on
 * the detail page is what actually runs the check when one is due.
 *
 * Paused while the tab is hidden, and refreshed on the way back. Every one of
 * these can cost live lookups against shared public resolvers, and a forgotten
 * background tab must not spend them.
 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter()

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined

    const start = () => {
      if (timer !== undefined) return
      timer = setInterval(() => {
        router.refresh()
      }, seconds * 1000)
    }

    const stop = () => {
      if (timer === undefined) return
      clearInterval(timer)
      timer = undefined
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Whatever happened while this tab was in the background happened.
        router.refresh()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [seconds, router])

  return null
}
