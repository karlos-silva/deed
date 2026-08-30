import { describe, expect, it } from 'vitest'
import { at } from '@deed/core'
import { createDohPort } from '../src/doh/adapter'

/**
 * D12: one live check, in the release path, never in the commit loop. Cloudflare
 * or Google having a bad afternoon is not a reason for our CI to be red — but
 * shipping without ever asking a real resolver a real question is worse.
 *
 *   RUN_LIVE_DNS=1 pnpm --filter @deed/dns test
 */
const LIVE = process.env['RUN_LIVE_DNS'] === '1'

describe('the release check', () => {
  it('Live DNS is checked once, and not in the commit loop', async (context) => {
    context.skip(!LIVE, 'set RUN_LIVE_DNS=1 — this runs before a release, not on every commit')

    const answers = await createDohPort().lookup('example.com', 'TXT', { now: at(0), timeoutMs: 8_000 })
    const answered = answers.filter((a) => a.outcome === 'answered')

    // Quorum, against the real internet, through the real endpoints.
    expect(answered.length).toBeGreaterThanOrEqual(2)
    for (const answer of answered) {
      expect(answer.values).toContain('v=spf1 -all')
      expect(answer.ttl).toBeGreaterThan(0)
    }
  }, 30_000)
})
