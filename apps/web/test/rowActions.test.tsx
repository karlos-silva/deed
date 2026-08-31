// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RowActions } from '../src/components/RowActions'

/**
 * The row menu is the only part of the list that does nothing without
 * JavaScript, so it is the only part a server-rendered assertion cannot reach.
 * The behaviour that matters is that the control is always there, that it opens,
 * and that it can be got out of — a menu you cannot dismiss is worse than none.
 */

// React needs to be told this is an act() environment before the first render.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const noop = (): void => undefined

let host: HTMLDivElement
let root: Root

const mount = (ui: React.ReactElement): void => {
  act(() => {
    root.render(ui)
  })
}

const click = (node: Element): void => {
  act(() => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const row = (state: 'live' | 'closed' | 'removed') => (
  <RowActions
    domainId="d1"
    name="acme.com"
    state={state}
    requireTyping={false}
    release={noop}
    remove={noop}
    restore={noop}
  />
)

const trigger = (): HTMLButtonElement => {
  const node = host.querySelector<HTMLButtonElement>('.row-menu')
  if (node === null) throw new Error('no trigger rendered')
  return node
}

const menu = (): HTMLElement | null => host.querySelector<HTMLElement>('.menu')

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

describe('the row menu', () => {
  it('is visible without hovering anything', () => {
    mount(row('closed'))

    // The bug this replaced: an opacity-0 control that a touch user never finds.
    expect(trigger().getAttribute('aria-label')).toBe('Actions for acme.com')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(menu()).toBeNull()
  })

  it('opens on click and closes on a second click', () => {
    mount(row('closed'))

    click(trigger())
    expect(menu()).not.toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(menu()?.getAttribute('role')).toBe('menu')

    click(trigger())
    expect(menu()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape, on an outside click, and on a scroll', () => {
    mount(row('closed'))

    click(trigger())
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(menu()).toBeNull()

    click(trigger())
    act(() => {
      document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).toBeNull()

    // It is anchored to a rect measured once, so a scroll has to dismiss it
    // rather than leave it floating away from its row.
    click(trigger())
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    expect(menu()).toBeNull()
  })

  it('stays open when the click lands inside it', () => {
    mount(row('closed'))

    click(trigger())
    const inside = menu()
    if (inside === null) throw new Error('menu did not open')
    act(() => {
      inside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).not.toBeNull()
  })

  it('offers Release, marked destructive, while the claim is live', () => {
    mount(row('live'))
    click(trigger())

    expect(menu()?.textContent).toContain('Release domain')
    // Releasing frees the name for anyone, so it is the one marked destructive.
    expect(menu()?.querySelector('.menu-item.danger')).not.toBeNull()
  })

  it('offers Remove, not marked destructive, once the claim is closed', () => {
    mount(row('closed'))
    click(trigger())

    expect(menu()?.textContent).toContain('Remove from list')
    // Nothing is destroyed and it is reversible, so it is not dressed as danger.
    expect(menu()?.querySelector('.menu-item.danger')).toBeNull()
  })

  it('offers Restore for a claim already off the list', () => {
    mount(row('removed'))
    click(trigger())

    expect(menu()?.textContent).toContain('Restore to list')
  })

  it('asks before releasing, rather than releasing from the menu', () => {
    mount(row('live'))
    click(trigger())

    const item = menu()?.querySelector('.menu-item')
    if (item == null) throw new Error('no menu item')
    click(item)

    // The menu closes and hands over to the confirmation, which is where the
    // guard lives — the list never revokes a claim in one click.
    expect(menu()).toBeNull()
    const dialog = host.querySelector('dialog.t-modal')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Release acme.com?')
  })
})
