import { describe, expect, it } from 'vitest'
import type { PreflightWarning, Provider } from '@deed/core'
import { type PreflightFindings, preflightSteps } from '../src/lib/preflightSteps'

const CLOUDFLARE: Provider = {
  id: 'cloudflare',
  name: 'Cloudflare',
  hostLabel: 'Name',
  valueLabel: 'Content',
  relativeHost: true,
  quirks: ['quoted_value'],
}

const clean: PreflightFindings = {
  registered: true,
  zoneFailing: false,
  provider: null,
  wildcard: null,
  cnameAtHost: null,
  warnings: [],
}

const withWarnings = (
  warnings: PreflightWarning[],
  over: Partial<PreflightFindings> = {},
): PreflightFindings => ({ ...clean, ...over, warnings })

const byId = (steps: ReturnType<typeof preflightSteps>, id: string) => {
  const step = steps.find((s) => s.id === id)
  if (step === undefined) throw new Error(`no ${id} step`)
  return step
}

describe('the zone analysis, as the checks it is', () => {
  it('asks four questions before it has any answers', () => {
    const steps = preflightSteps('acme.com', null)

    // The wait names what is being looked for. A spinner does not.
    expect(steps).toHaveLength(4)
    expect(steps.every((step) => step.state === 'todo')).toBe(true)
    expect(steps.every((step) => step.detail === null)).toBe(true)
  })

  it('answers all four when the zone is clean', () => {
    const steps = preflightSteps('acme.com', clean)

    // The checks that passed used to render as nothing at all, so a clean zone
    // and a zone nobody had looked at were the same screen.
    expect(steps.every((step) => step.state === 'done')).toBe(true)
    expect(byId(steps, 'host').detail).toContain('_deed-challenge.acme.com')
    expect(byId(steps, 'provider').detail).toContain('generic')
  })

  it('fails the delegation step, in the diagnosis\'s own words', () => {
    const unregistered = preflightSteps('nothere.com', withWarnings([{ kind: 'domain_unregistered' }], { registered: false }))
    expect(byId(unregistered, 'delegation').state).toBe('failed')

    const failing = preflightSteps('broken.com', withWarnings([{ kind: 'zone_failing' }], { zoneFailing: true }))
    expect(byId(failing, 'delegation').state).toBe('failed')

    // Every other question still has its answer: one bad finding does not
    // silence the rest of the report.
    expect(byId(failing, 'host').state).toBe('done')
  })

  it('fails the host step when something already lives there', () => {
    const steps = preflightSteps(
      'acme.com',
      withWarnings([{ kind: 'cname_at_host', target: 'shop.myshopify.com' }], {
        cnameAtHost: 'shop.myshopify.com',
      }),
    )
    const host = byId(steps, 'host')

    expect(host.state).toBe('failed')
    expect(host.detail).toContain('shop.myshopify.com')
    // The fix travels with it — a diagnosis the user cannot act on is a verdict.
    expect(host.detail).toMatch(/Remove|claim a different/i)
  })

  it('does not treat a wildcard as a failure', () => {
    const steps = preflightSteps('acme.com', withWarnings([{ kind: 'wildcard', value: 'v=spf1 -all' }], { wildcard: 'v=spf1 -all' }))
    const wildcard = byId(steps, 'wildcard')

    // Legal, common, and ours to handle: an explicit record outranks it.
    expect(wildcard.state).toBe('done')
    expect(wildcard.title.toLowerCase()).toContain('wildcard')
  })

  it('names the provider, and its quirk as a headline rather than a lecture', () => {
    const steps = preflightSteps(
      'acme.com',
      withWarnings([{ kind: 'provider_quirk', provider: CLOUDFLARE, cause: 'quoted_value' }], {
        provider: CLOUDFLARE,
      }),
    )
    const provider = byId(steps, 'provider')

    expect(provider.state).toBe('done')
    expect(provider.detail).toContain('Cloudflare')
    // The paragraph explaining it belongs beside the field being pasted into,
    // which is the record card, not this dialog.
    expect(provider.detail?.length ?? 0).toBeLessThan(120)
  })
})
