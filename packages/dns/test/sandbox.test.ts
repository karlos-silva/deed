import { describe, expect, it } from 'vitest'
import {
  RESOLVERS,
  challengeHost,
  deriveRecord,
  expectedValue,
  plus,
  seconds,
  token,
  type RecordState,
} from '@deed/core'
import { T0, TOKEN_A, VALUE_A } from '@deed/core/testing'
import { createSandboxPort } from '../src/sandbox/adapter'
import { type SandboxZone, addRecord, deleteRecord, emptyZone } from '../src/sandbox/zone'
import { observe } from '../src/observe'
import { describeResolverContract } from './contract'
import { NAME, PROBE_LABEL, SETTLED, WILDCARD, sandboxHarness } from './harnesses'

const HOST = challengeHost(NAME)
const UNCHECKED: RecordState = { status: 'unchecked' }
const expectation = { domain: NAME, current: TOKEN_A, superseded: [] }

let counter = 0
const nextId = () => `s${++counter}`

const zoneWith = (...values: { host: string; value: string }[]): SandboxZone =>
  values.reduce(
    (zone, v) => addRecord(zone, { id: nextId(), host: v.host, value: v.value }, T0),
    emptyZone(NAME),
  )

describe('the sandbox adapter', () => {
  describeResolverContract(sandboxHarness)
})

describe('what only the sandbox can stage', () => {
  it('A wildcard answers for a host nobody created', async () => {
    const zone = zoneWith({ host: '*', value: WILDCARD })
    const check = await observe(createSandboxPort(zone), NAME, {
      now: SETTLED,
      actor: 'user',
      probeLabel: PROBE_LABEL,
    })

    const record = deriveRecord(check, expectation, UNCHECKED)
    expect(record).toMatchObject({ status: 'mismatch', cause: 'wildcard_shadow' })

    // The copy says the record is missing, not that its value is wrong: the
    // observed value is the wildcard's, and none of it is the user's doing.
    if (record.status !== 'mismatch') return
    expect(record.observed.every((o) => o.kind === 'wildcard_served')).toBe(true)
    expect(record.observed.map((o) => o.value)).not.toContain(VALUE_A)
  })

  it('A wildcard does not veto a real record', async () => {
    // `* IN TXT "v=spf1 -all"` is a recommended anti-spoofing practice. A zone
    // that does the right thing must not fail verification forever.
    const zone = zoneWith({ host: '*', value: WILDCARD }, { host: '_deed-challenge', value: VALUE_A })
    const check = await observe(createSandboxPort(zone), NAME, {
      now: SETTLED,
      actor: 'user',
      probeLabel: PROBE_LABEL,
    })

    const record = deriveRecord(check, expectation, UNCHECKED)
    expect(record).toMatchObject({ status: 'verified', seenBy: [...RESOLVERS] })
  })

  it('each resolver adopts a change on its own clock', async () => {
    const zone = zoneWith({ host: '_deed-challenge', value: VALUE_A })
    const port = createSandboxPort(zone)

    // Cloudflare at 25s, Google at 55s, AdGuard at 95s.
    const at40 = await port.lookup(HOST, 'TXT', { now: plus(T0, seconds(40)) })
    expect(at40.filter((a) => a.outcome === 'answered').map((a) => a.resolver)).toEqual(['cloudflare'])

    const at60 = await port.lookup(HOST, 'TXT', { now: plus(T0, seconds(60)) })
    expect(at60.filter((a) => a.outcome === 'answered')).toHaveLength(2)

    const at100 = await port.lookup(HOST, 'TXT', { now: plus(T0, seconds(100)) })
    expect(at100.filter((a) => a.outcome === 'answered')).toHaveLength(3)
  })

  it('a deleted record keeps being served until each cache clears', async () => {
    const id = nextId()
    const published = addRecord(emptyZone(NAME), { id, host: '_deed-challenge', value: VALUE_A }, T0)
    const removed = deleteRecord(published, id, plus(T0, seconds(200)))
    const port = createSandboxPort(removed)

    // Deleted at 200s: Cloudflare drops it at 225s, AdGuard not until 295s.
    const at230 = await port.lookup(HOST, 'TXT', { now: plus(T0, seconds(230)) })
    expect(at230.filter((a) => a.outcome === 'answered').map((a) => a.resolver)).toEqual([
      'google',
      'adguard',
    ])

    const at300 = await port.lookup(HOST, 'TXT', { now: plus(T0, seconds(300)) })
    expect(at300.every((a) => a.outcome === 'nxdomain')).toBe(true)
  })

  it('a value nobody published is diagnosed, not accepted', async () => {
    const other = expectedValue(token('z'.repeat(52)))
    const zone = zoneWith({ host: '_deed-challenge', value: other })
    const check = await observe(createSandboxPort(zone), NAME, {
      now: SETTLED,
      actor: 'user',
      probeLabel: PROBE_LABEL,
    })
    expect(deriveRecord(check, expectation, UNCHECKED)).toMatchObject({
      status: 'mismatch',
      cause: 'wrong_token',
    })
  })
})
