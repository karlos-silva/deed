import { describe, expect, it } from 'vitest'
import type { AuditRow } from '@deed/db'
import { actorPhrase, toLogEntries, toneOf } from '../src/lib/logEntries'

const row = (id: number, over: Partial<AuditRow> = {}): AuditRow => ({
  id,
  domain_id: 'd',
  owner_id: 'u',
  domain_name: 'demo.karlos.dev',
  at: new Date(1_767_225_600_000 - id * 30_000).toISOString(),
  kind: 'check_completed',
  actor: 'sweep',
  level: null,
  from_status: null,
  to_status: 'verified',
  evidence: null,
  ...over,
})

describe('the log', () => {
  it('collapses a run of unchanged checks into one entry', () => {
    // What the user photographed: fourteen identical rows.
    const entries = toLogEntries(Array.from({ length: 14 }, (_, i) => row(i + 1)))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'watch', count: 14 })
  })

  it('never collapses a transition into the noise around it', () => {
    const entries = toLogEntries([
      row(1),
      row(2),
      row(3, { kind: 'state_changed', level: 'claim', from_status: 'pending', to_status: 'verified' }),
      row(4, { to_status: 'absent' }),
      row(5, { kind: 'claim_created', actor: 'user', to_status: 'pending' }),
    ])
    expect(entries.map((e) => e.kind)).toEqual(['watch', 'moment', 'watch', 'moment'])
    expect(entries[0]).toMatchObject({ count: 2 })
  })

  it('starts a new run when the checks stop agreeing', () => {
    const entries = toLogEntries([row(1), row(2), row(3, { to_status: 'propagating' })])
    expect(entries.map((e) => e.kind)).toEqual(['watch', 'watch'])
    expect(entries.map((e) => (e.kind === 'watch' ? e.count : 0))).toEqual([2, 1])
  })

  it('says who in words, not in the enum', () => {
    expect(actorPhrase('sweep')).not.toMatch(/sweep/i)
    expect(actorPhrase('system')).not.toMatch(/system/i)
    expect(actorPhrase('user')).toBe('you')
  })

  it('gives a transition a tone so it cannot look like a no-op', () => {
    expect(toneOf(row(1, { kind: 'state_changed', to_status: 'verified' }))).toBe('ok')
    expect(toneOf(row(1, { kind: 'state_changed', to_status: 'degraded' }))).toBe('problem')
    expect(toneOf(row(1, { kind: 'released' }))).toBe('closed')
  })
})
