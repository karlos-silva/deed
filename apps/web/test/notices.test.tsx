// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a server action says after it lands. The callout this replaced lived in
 * the query string, so it stayed on screen until you navigated away — and came
 * back if you reloaded. The parameter must be gone the moment it has been read.
 */

const replace = vi.fn()
let search = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useSearchParams: () => search,
  usePathname: () => '/domains',
  useRouter: () => ({ replace }),
}))

const restore = vi.fn()
const remove = vi.fn()
vi.mock('@/app/domains/actions', () => ({
  restoreToList: (form: FormData): void => {
    restore(form)
  },
  removeFromList: (form: FormData): void => {
    remove(form)
  },
}))

const { toast } = await import('sonner')
const { Notices } = await import('../src/components/Notices')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

// sonner keeps its toasts in a store the Toaster subscribes to, and the render
// that shows one lands a task after the effect fires.
const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const mount = async (): Promise<void> => {
  act(() => {
    root.render(<Notices />)
  })
  await flush()
}

const toasts = (): string => document.querySelector('[data-sonner-toaster]')?.textContent ?? ''
const action = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>('[data-sonner-toast] [data-button]')

beforeEach(() => {
  replace.mockClear()
  restore.mockClear()
  remove.mockClear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  // The store is module-global, so anything left queued would surface in the
  // next test's Toaster.
  toast.dismiss()
  await flush()
  act(() => {
    root.unmount()
  })
  host.remove()
  document.querySelectorAll('section[aria-label]').forEach((n) => {
    n.remove()
  })
})

describe('what an action says once it lands', () => {
  it('says nothing when there is nothing to say', async () => {
    search = new URLSearchParams()
    await mount()

    expect(toasts()).toBe('')
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows the message and then strips it from the URL', async () => {
    search = new URLSearchParams({ toast: 'karlos.dev removed from your list.' })
    await mount()

    expect(toasts()).toContain('karlos.dev removed from your list.')
    // The whole point: it cannot survive a reload.
    expect(replace).toHaveBeenCalledWith('/domains', { scroll: false })
  })

  it('offers Undo only when the action can be taken back', async () => {
    search = new URLSearchParams({
      toast: 'karlos.dev removed from your list.',
      undo: 'restore',
      undoId: 'abc-123',
    })
    await mount()

    const button = action()
    expect(button?.textContent).toBe('Undo')

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
    expect(restore).toHaveBeenCalledTimes(1)
    expect((restore.mock.calls[0]?.[0] as FormData).get('id')).toBe('abc-123')
  })

  it('offers no Undo for a release, which cannot be undone', async () => {
    search = new URLSearchParams({
      toast: 'karlos.dev released. The name is free for anyone to claim again.',
      tone: 'danger',
    })
    await mount()

    // The name went back to the pool as this committed; a button promising
    // otherwise would be a lie.
    expect(action()).toBeNull()
    expect(document.querySelector('[data-sonner-toast]')?.getAttribute('data-type')).toBe('error')
  })

  it('does not fire twice when the effect runs again', async () => {
    search = new URLSearchParams({ toast: 'Once.', tid: '1' })
    await mount()
    await mount()

    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
  })

  it('says the same thing twice when it happened twice', async () => {
    // Remove a domain, undo, remove it again: byte-identical copy. Keying the
    // guard on the message would swallow the second, and the removal would look
    // as though it had silently failed.
    search = new URLSearchParams({ toast: 'karlos.dev removed from your list.', tid: '1' })
    await mount()
    search = new URLSearchParams({ toast: 'karlos.dev removed from your list.', tid: '2' })
    await mount()

    expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(2)
  })

  it('cleans the URL even for a message it has already shown', async () => {
    search = new URLSearchParams({ toast: 'Once.', tid: '1' })
    await mount()
    replace.mockClear()
    await mount()

    // Otherwise the parameter sits in the address bar and re-fires on reload.
    expect(replace).toHaveBeenCalledWith('/domains', { scroll: false })
  })
})
