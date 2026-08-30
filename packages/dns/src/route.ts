import type { DnsPort } from './port'
import { createDohPort, type DohOptions } from './doh/adapter'
import { createSandboxPort } from './sandbox/adapter'
import { type SandboxZone, emptyZone } from './sandbox/zone'

/**
 * `.test` is reserved by RFC 2606 for exactly this purpose and can never resolve
 * in real DNS, which makes it impossible to confuse a simulated verification
 * with a real one (D10).
 */
export const SANDBOX_SUFFIX = 'test'

export const isSandboxName = (name: string): boolean => {
  const trimmed = name.replace(/\.$/, '').toLowerCase()
  return trimmed === SANDBOX_SUFFIX || trimmed.endsWith(`.${SANDBOX_SUFFIX}`)
}

export type ZoneLoader = (name: string) => Promise<SandboxZone | null>

export type RouterOptions = {
  readonly loadZone: ZoneLoader
  readonly doh?: DnsPort
  readonly dohOptions?: DohOptions
}

/**
 * Routing is total: a `.test` name is served by the sandbox and never reaches
 * the network, and every other name is served by real resolvers.
 */
export function createRouter(options: RouterOptions): (name: string) => Promise<DnsPort> {
  const doh = options.doh ?? createDohPort(options.dohOptions ?? {})
  return async (name: string) => {
    if (!isSandboxName(name)) return doh
    const zone = await options.loadZone(name)
    return createSandboxPort(zone ?? emptyZone(name))
  }
}
