import { describe, expect, it } from 'vitest'
import type { AuditRow } from '@deed/db'
import { actorPhrase, toneOf } from '../src/lib/logEntries'

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
