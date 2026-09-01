import { type Domain, isTerminal } from '@deed/core'
import { claimGuidance, endedHeadline, recordGuidance } from '@/lib/copy'

export type Verdict = {
  readonly tone: 'success' | 'info' | 'warning' | 'danger'
  readonly headline: string
  readonly body: string
  readonly fix?: string
  /** prd §7: every diagnosis answers "does waiting help?" — or says nothing. */
  readonly waitingHelps: boolean | null
  /** prd §6.5: the one celebratory moment, and only on the render that earned it. */
  readonly celebrate: boolean
}

/**
 * One banner, from one function that reads both lifecycles.
 *
 * The page used to run `claimGuidance` and `recordGuidance` side by side and
 * print whatever each returned, which is how a released domain came to say "You
 * released this domain" and "Ownership proven — we keep checking" forty pixels
 * apart. Only one of the two can be the news, and which one depends on the
 * claim: while a claim is pending the record is the whole story, and once the
 * claim has moved the claim is.
 */
export function verdict(domain: Domain, justVerified = false): Verdict {
  const ownership = domain.ownership

  if (isTerminal(ownership)) {
    const closed = claimGuidance(ownership)
    return {
      tone: 'info',
      headline: closed?.headline ?? endedHeadline(ownership),
      body: closed?.body ?? 'This claim is closed. Its history is below.',
      ...(closed?.fix !== undefined && { fix: closed.fix }),
      waitingHelps: null,
      celebrate: false,
    }
  }

  if (ownership.status === 'degraded') {
    // The claim outranks the record here: the record is `absent`, and saying
    // "that is normal before you add it" to somebody about to lose a name they
    // proved would be the worst sentence on the site.
    const risk = claimGuidance(ownership)
    return {
      tone: 'danger',
      headline: risk?.headline ?? 'Ownership is at risk',
      body: risk?.body ?? '',
      ...(risk?.fix !== undefined && { fix: risk.fix }),
      waitingHelps: false,
      celebrate: false,
    }
  }

  if (ownership.status === 'verified') {
    const proven = recordGuidance(domain)
    return {
      tone: 'success',
      headline: 'Ownership proven',
      body: proven.body,
      waitingHelps: null,
      celebrate: justVerified,
    }
  }

  // Pending: nothing has happened to the claim yet, so the record is the news.
  const record = recordGuidance(domain)
  return {
    tone: record.tone === 'problem' ? 'warning' : 'info',
    headline: record.headline,
    body: record.body,
    ...(record.fix !== undefined && { fix: record.fix }),
    waitingHelps: record.waitingHelps,
    celebrate: false,
  }
}
