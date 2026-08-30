import { describe, expect, it, vi } from 'vitest'
import { challengeHost, plus, seconds } from '@deed/core'
import { T0, VALUE_A } from '@deed/core/testing'
import { createDohPort } from '../src/doh/adapter'
import { createRouter, isSandboxName } from '../src/route'
import { observe, randomProbeLabel } from '../src/observe'
import { addRecord, emptyZone } from '../src/sandbox/zone'

describe('routing', () => {
  it('Sandbox routing is total', async () => {
    const network = vi.fn<typeof globalThis.fetch>()
    const zone = addRecord(
      emptyZone('acme.test'),
      { id: 'r1', host: '_deed-challenge', value: VALUE_A },
      T0,
    )

    const route = createRouter({
      loadZone: (name) => Promise.resolve(name === 'acme.test' ? zone : null),
      doh: createDohPort({ fetch: network }),
    })

    const port = await route('acme.test')
    const now = plus(T0, seconds(200))

    // Every lookup a real check makes: the challenge host and the control probe.
    await observe(port, 'acme.test', { now, actor: 'user', probeLabel: randomProbeLabel() })
    await port.lookupTxt(challengeHost('acme.test'), { now })

    expect(network).not.toHaveBeenCalled()
  })

  it('a sandbox name with no zone yet answers nxdomain rather than reaching out', async () => {
    const network = vi.fn<typeof globalThis.fetch>()
    const route = createRouter({
      loadZone: () => Promise.resolve(null),
      doh: createDohPort({ fetch: network }),
    })

    const answers = await (await route('nobody.test')).lookupTxt('_deed-challenge.nobody.test', {
      now: T0,
    })
    expect(answers.every((a) => a.outcome === 'nxdomain')).toBe(true)
    expect(network).not.toHaveBeenCalled()
  })

  it('every other name goes to the real resolvers', async () => {
    const network = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ Status: 3 }), { status: 200 })),
    )
    const route = createRouter({
      loadZone: () => Promise.resolve(null),
      doh: createDohPort({ fetch: network }),
    })

    await (await route('acme.com')).lookupTxt('_deed-challenge.acme.com', { now: T0 })
    expect(network).toHaveBeenCalledTimes(3)
  })

  it('recognises the reserved suffix and nothing that merely looks like it', () => {
    for (const name of ['acme.test', 'updates.acme.test', 'ACME.TEST', 'acme.test.', 'test']) {
      expect(isSandboxName(name), name).toBe(true)
    }
    for (const name of ['acme.com', 'test.com', 'acmetest', 'my-test.org', 'testing']) {
      expect(isSandboxName(name), name).toBe(false)
    }
  })
})
