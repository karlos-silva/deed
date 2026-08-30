import type { DnsPort } from './port'
import { createDohPort, type DohOptions } from './doh/adapter'
import { createSandboxPort } from './sandbox/adapter'
import { type SandboxZone, emptyZone } from './sandbox/zone'

/** RFC 2606 reserves `.test`, so it can never resolve in real DNS (D10). */
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

export function createRouter(options: RouterOptions): (name: string) => Promise<DnsPort> {
  const doh = options.doh ?? createDohPort(options.dohOptions ?? {})
  return async (name: string) => {
    if (!isSandboxName(name)) return doh
    const zone = await options.loadZone(name)
    return createSandboxPort(zone ?? emptyZone(name))
  }
}
