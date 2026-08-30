import { expect, it } from 'vitest'
import type { ResolverAnswer, Timestamp } from '@deed/core'
import { RESOLVERS } from '@deed/core'
import type { DnsPort } from '../src/port'

/**
 * One contract, two adapters (D2). Real DoH and the simulated zone must be
 * indistinguishable to the engine, so the same suite runs against both and
 * neither is allowed to skip a case the other passes.
 */
export const CONTRACT_CASES = [
  'single-value',
  'chunked-value',
  'multiple-records',
  'nxdomain',
  'nodata',
  'cname-at-host',
  'servfail',
  'refused',
  'dnssec',
  'timeout',
  'throttled',
  'wildcard-only',
  'wildcard-and-record',
] as const

export type ContractCase = (typeof CONTRACT_CASES)[number]

export type Staged = {
  readonly port: DnsPort
  /** The host the case is about. */
  readonly host: string
  /** A sibling label that no record was ever created at — the control probe. */
  readonly probeHost: string
  readonly now: Timestamp
  /** The value the case publishes, where it publishes one. */
  readonly value?: string
}

export type ContractHarness = {
  readonly name: string
  /** Every harness must stage every case. Throwing is how a gap announces itself. */
  stage(kase: ContractCase): Promise<Staged>
}

const each = (answers: readonly ResolverAnswer[]) => {
  expect(answers.map((a) => a.resolver).sort()).toEqual([...RESOLVERS].sort())
  return answers
}

export function describeResolverContract(harness: ContractHarness): void {
  const look = async (kase: ContractCase, which: 'host' | 'probeHost' = 'host') => {
    const staged = await harness.stage(kase)
    const answers = await staged.port.lookupTxt(staged[which], { now: staged.now })
    return { staged, answers: each(answers) }
  }

  it(`a published value comes back verbatim`, async () => {
    const { staged, answers } = await look('single-value')
    for (const answer of answers) {
      expect(answer.outcome).toBe('answered')
      if (answer.outcome !== 'answered') return
      expect(answer.values).toContain(staged.value)
      expect(answer.ttl).toBeGreaterThan(0)
    }
  })

  it(`A long value arrives in chunks`, async () => {
    const { staged, answers } = await look('chunked-value')
    const seen: string[][] = []
    for (const answer of answers) {
      expect(answer.outcome).toBe('answered')
      if (answer.outcome !== 'answered') return
      // Joined with no separator, and with the transport's quoting removed.
      for (const value of answer.values) {
        expect(value).not.toMatch(/^"|"$|" "/)
      }
      expect(answer.values.some((v) => v.length > 255)).toBe(true)
      if (staged.value !== undefined) expect(answer.values).toContain(staged.value)
      seen.push([...answer.values].sort())
    }
    // Three transports, three encodings of the same record, one identical answer.
    for (const values of seen) expect(values).toEqual(seen[0])
  })

  it(`a host holding several records returns all of them`, async () => {
    const { answers } = await look('multiple-records')
    for (const answer of answers) {
      expect(answer.outcome).toBe('answered')
      if (answer.outcome !== 'answered') return
      // Ours needs to be present among them, not alone (state-model §3).
      expect(answer.values.length).toBeGreaterThanOrEqual(2)
    }
  })

  it(`a name that does not exist is nxdomain`, async () => {
    const { answers } = await look('nxdomain')
    for (const answer of answers) expect(answer.outcome).toBe('nxdomain')
  })

  it(`a name with no TXT is nodata, not nxdomain`, async () => {
    const { answers } = await look('nodata')
    for (const answer of answers) expect(answer.outcome).toBe('nodata')
  })

  it(`a CNAME at the host is carried, because it is the reason`, async () => {
    const { answers } = await look('cname-at-host')
    for (const answer of answers) {
      expect(answer.outcome).not.toBe('answered')
      expect(answer).toHaveProperty('cname')
    }
  })

  it(`Their failure is not our failure`, async () => {
    for (const [kase, detail] of [
      ['servfail', 'servfail'],
      ['refused', 'refused'],
      ['dnssec', 'dnssec'],
    ] as const) {
      const { answers } = await look(kase)
      for (const answer of answers) {
        expect(answer.outcome, `${kase} at ${answer.resolver}`).toBe('zone_error')
        if (answer.outcome === 'zone_error') expect(answer.detail).toBe(detail)
      }
    }

    for (const [kase, detail] of [
      ['timeout', 'timeout'],
      ['throttled', 'throttled'],
    ] as const) {
      const { answers } = await look(kase)
      for (const answer of answers) {
        expect(answer.outcome, `${kase} at ${answer.resolver}`).toBe('check_failed')
        if (answer.outcome === 'check_failed') expect(answer.detail).toBe(detail)
      }
    }
  })

  it(`a wildcard answers a label nobody created`, async () => {
    const { staged, answers } = await look('wildcard-only', 'probeHost')
    for (const answer of answers) {
      expect(answer.outcome).toBe('answered')
      if (answer.outcome === 'answered') expect(answer.values).toContain(staged.value)
    }
  })

  it(`an explicit record overrides the wildcard`, async () => {
    const staged = await harness.stage('wildcard-and-record')
    const atHost = each(await staged.port.lookupTxt(staged.host, { now: staged.now }))
    const atProbe = each(await staged.port.lookupTxt(staged.probeHost, { now: staged.now }))

    for (const answer of atHost) {
      expect(answer.outcome).toBe('answered')
      if (answer.outcome === 'answered') expect(answer.values).toEqual([staged.value])
    }
    // The wildcard is still there — it just does not get to answer for the host.
    for (const answer of atProbe) {
      expect(answer.outcome).toBe('answered')
      if (answer.outcome === 'answered') expect(answer.values).not.toContain(staged.value)
    }
  })
}
