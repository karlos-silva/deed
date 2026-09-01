// Types only: a value import reaches core's barrel and ships the 140KB Public Suffix List to the browser.
import type {
  Domain,
  MismatchCause,
  OwnershipState,
  PreflightWarning,
  Provider,
  RecordState,
  ResolverId,
} from '@deed/core'

export type Guidance = {
  readonly headline: string
  readonly body: string
  /** `null` where the honest answer is "we cannot tell yet". */
  readonly waitingHelps: boolean | null
  readonly fix?: string
  readonly tone: 'ok' | 'progress' | 'problem' | 'unknown'
}

export const RESOLVER_NAMES: Record<ResolverId, string> = {
  cloudflare: 'Cloudflare · 1.1.1.1',
  google: 'Google · 8.8.8.8',
  adguard: 'AdGuard · unfiltered',
}

export function recordGuidance(domain: Domain): Guidance {
  const record = domain.record
  switch (record.status) {
    case 'unchecked':
      return {
        headline: 'Not looked yet',
        body: 'The first check has not finished. Nothing has been concluded about your zone.',
        waitingHelps: true,
        tone: 'unknown',
      }

    case 'absent':
      return record.cname === undefined
        ? {
            headline: 'The record is not there yet',
            body:
              record.kind === 'nxdomain'
                ? `No resolver has ${challengeHostOf(domain)} at all. That is normal before you add it — most providers publish within a few minutes.`
                : 'The host exists but holds no TXT record. Check that the record type is TXT and that the host is exactly as shown.',
            waitingHelps: true,
            tone: 'progress',
          }
        : {
            headline: 'A CNAME at this host prevents the TXT from resolving',
            body: `${challengeHostOf(domain)} is a CNAME to ${record.cname}. DNS does not allow other records alongside a CNAME, so the TXT can never answer here.`,
            fix: 'Remove the CNAME at this host, or claim a different subdomain.',
            waitingHelps: false,
            tone: 'problem',
          }

    case 'propagating': {
      const seen = record.seenBy.map((r) => RESOLVER_NAMES[r]).join(', ')
      if (record.staleAt.length > 0 && record.seenBy.length === 0) {
        return {
          headline: 'Your previous token is still cached',
          body: `${record.staleAt.map((r) => RESOLVER_NAMES[r]).join(', ')} still answer with the token you rotated out. That clears on its own; the new one has not reached them yet.`,
          waitingHelps: true,
          tone: 'progress',
        }
      }
      return record.direction === 'arriving'
        ? {
            headline: `Seen by ${record.seenBy.length} of 3 resolvers`,
            body: `${seen} already ${record.seenBy.length === 1 ? 'has' : 'have'} it. The rest are still serving a cached answer, for up to ${humanTtl(record.ttl.max)}.`,
            waitingHelps: true,
            tone: 'progress',
          }
        : {
            headline: 'The record is disappearing',
            body: `Only ${seen} still ${record.seenBy.length === 1 ? 'answers' : 'answer'} with your token. This is what a deleted or edited record looks like from outside — if you did not change it, someone with access to the zone did.`,
            waitingHelps: false,
            tone: 'problem',
          }
    }

    case 'verified':
      return {
        headline: 'Ownership proven',
        body: `${record.seenBy.length} of 3 resolvers answer with your token. We keep checking, so this stays a fact rather than a badge.`,
        waitingHelps: null,
        tone: 'ok',
      }

    case 'mismatch':
      return mismatchGuidance(domain, record)

    case 'zone_error':
      return {
        headline: 'Your zone is failing to answer',
        body:
          record.errors.some((e) => e.side === 'zone' && e.detail === 'dnssec')
            ? 'Every resolver reports a DNSSEC validation failure for this zone. Until that is fixed, nobody can read any record here — not just ours.'
            : 'Every resolver got a failure from your nameservers rather than an answer. This is upstream of us and upstream of this record.',
        fix: 'Check your zone with your DNS provider or at dnsviz.net.',
        waitingHelps: null,
        tone: 'problem',
      }

    case 'check_failed':
      return {
        headline: 'We could not complete the check',
        body: 'Our lookups failed on our side — a timeout or a rate limit at the resolvers we query. Nothing about your DNS has been concluded, and nothing has changed.',
        waitingHelps: true,
        tone: 'unknown',
      }
  }
}

function mismatchGuidance(domain: Domain, record: Extract<RecordState, { status: 'mismatch' }>): Guidance {
  // A corrected mistake still clearing caches reads differently from a fresh one (state-model §3).
  if (record.correcting !== null) {
    return {
      headline: 'Your correction is on its way',
      body: `The right value is already at ${record.correcting.seenBy.map((r) => RESOLVER_NAMES[r]).join(', ')}. ${record.correcting.clearingAt.map((r) => RESOLVER_NAMES[r]).join(', ')} still serve the old one, for up to ${humanTtl(record.correcting.ttl.max)}.`,
      waitingHelps: true,
      tone: 'progress',
    }
  }

  switch (record.cause) {
    case 'quoted_value':
      return {
        headline: 'Your provider wrapped the value in quotes',
        body: 'The value in your zone is our token with a pair of double quotes around it. Some panels add them when you paste a value that already has them — Cloudflare is the usual one.',
        fix: 'Paste the value without quotes. The panel adds its own.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'appended_apex':
      return {
        headline: 'Your provider appended the zone name',
        body: `The value ends with ${domain.name} added to it. Panels that treat a value as a hostname do this — Route 53 among them.`,
        fix: 'Add a trailing dot, or use the panel’s "raw value" field, so it is stored as text rather than as a name.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'whitespace':
      return {
        headline: 'An invisible character survived the paste',
        body: 'The value is right apart from whitespace — a space, a tab, or a zero-width character that came along with the copy.',
        fix: 'Use the copy button here rather than selecting the text by hand.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'truncated':
      return {
        headline: 'The panel cut the value short',
        body: 'What is published is the beginning of our token and nothing after it. Some panels silently truncate long values.',
        fix: 'Re-paste the whole value and check it is stored in full; if the field has a length limit, use the panel’s multi-line or raw entry.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'wrong_token':
      return {
        headline: 'This token belongs to a different claim',
        body: 'The value is a well-formed token of ours, but not the one issued for this claim. It usually means an older claim, or another account’s.',
        fix: 'Replace it with the value shown here.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'wildcard_shadow':
      return {
        headline: 'The record is missing; a wildcard is answering in its place',
        body: `Your zone has a wildcard TXT record, so ${challengeHostOf(domain)} answers with the wildcard’s value instead of nothing. The challenge record itself has not been created.`,
        fix: 'Create the TXT record below. An explicit record overrides the wildcard — the wildcard does not block it, and waiting will not create it for you.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'unknown_value':
      return {
        headline: 'The value is not the one we issued',
        body: 'Something is published at this host, and no known provider quirk explains the difference. The character-level diff below shows exactly where it deviates.',
        fix: 'Replace the value with the one shown here.',
        waitingHelps: false,
        tone: 'problem',
      }
  }
}

export function claimGuidance(ownership: OwnershipState): Guidance | null {
  switch (ownership.status) {
    case 'pending':
    case 'verified':
      return null

    case 'degraded':
      return {
        headline: 'Ownership is at risk',
        body: 'The proof that was here is gone. Until it is back, this domain cannot be used to grant anything that depends on owning it — and if it stays gone, the claim is released and the name returns to the pool.',
        fix: 'Restore the TXT record below. Recovery costs nothing and resets the window completely.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'expired':
      return {
        headline: 'This claim expired',
        body: 'Fourteen days passed without the token appearing in your zone, so the claim lapsed. Nothing was taken away — it was never proven.',
        fix: 'Claim the domain again to get a fresh token.',
        waitingHelps: false,
        tone: 'unknown',
      }

    case 'revoked':
      return {
        headline: revokedHeadline(ownership.reason),
        body: revokedBody(ownership.reason),
        waitingHelps: false,
        tone: 'problem',
      }
  }
}

export const revokedHeadline = (reason: Extract<OwnershipState, { status: 'revoked' }>['reason']): string => {
  switch (reason) {
    case 'grace_expired':
      return 'This claim was released'
    case 'released_by_owner':
      return 'You released this domain'
    case 'claimed_by_other':
      return 'Another account proved this domain first'
  }
}

const revokedBody = (reason: Extract<OwnershipState, { status: 'revoked' }>['reason']): string => {
  switch (reason) {
    case 'grace_expired':
      return 'The proof stayed gone through the whole grace window and a conclusive check confirmed it, so the name went back to the pool. The history below is still yours to read.'
    case 'released_by_owner':
      return 'You deleted this claim, which freed the name for others. The history below is still yours to read.'
    case 'claimed_by_other':
      return 'Claiming is open to anyone — proof is not. Somebody published their token at this domain before you did, so their claim is now the exclusive one and yours was closed. Nothing you did was wrong; you did not control the zone.'
  }
}

/** One line for how a closed claim ended, for the Removed list. */
export function endedHeadline(ownership: OwnershipState): string {
  switch (ownership.status) {
    case 'expired':
      return 'This claim expired'
    case 'revoked':
      return revokedHeadline(ownership.reason)
    case 'pending':
    case 'verified':
    case 'degraded':
      return 'Still open'
  }
}

/** The caption over the resolver rows: what the three of them add up to. */
export function matrixSummary(record: RecordState): string {
  switch (record.status) {
    case 'unchecked':
      return 'No resolver has been asked yet'
    case 'absent':
      return 'No resolver has the record'
    case 'verified':
      return `All ${record.seenBy.length} resolvers answer with your token`
    case 'propagating':
      return `${record.seenBy.length} of 3 resolvers have it so far`
    case 'mismatch':
      return 'What each resolver answered, and why it does not count'
    case 'zone_error':
      return 'A resolver could not read the zone'
    case 'check_failed':
      return 'Our lookup failed — this says nothing about your DNS'
  }
}

export const causeWaitingHelps = (cause: MismatchCause): boolean => {
  switch (cause) {
    case 'quoted_value':
    case 'appended_apex':
    case 'whitespace':
    case 'truncated':
    case 'wrong_token':
    case 'wildcard_shadow':
    case 'unknown_value':
      return false
  }
}

export const challengeHostOf = (domain: Domain): string => `_deed-challenge.${domain.name}`

/**
 * When preflight names the provider we print that provider's own field names,
 * which is what every survey source solves in a troubleshooting paragraph
 * instead. When it does not, we hedge: `Host / Name` is the header the careful
 * products ship, and the ones that hedged were right to — the host column is
 * called Name, Host or Hostname depending on whose panel you open.
 */
export const fieldLabels = (provider: Provider | null) => ({
  host: provider?.hostLabel ?? 'Host / Name',
  value: provider?.valueLabel ?? 'Value',
  relativeHost: provider?.relativeHost ?? true,
  name: provider?.name ?? null,
})

export function warningCopy(warning: PreflightWarning): Guidance {
  switch (warning.kind) {
    case 'provider_quirk':
      return quirkCopy(warning.provider, warning.cause)

    case 'wildcard':
      return {
        headline: 'This zone has a wildcard TXT record',
        body: `A random hostname under this domain already answers with “${warning.value}”. That is fine — an explicit record always wins over a wildcard — but it means a missing record looks present, so we check for it explicitly rather than trusting the answer.`,
        waitingHelps: null,
        tone: 'unknown',
      }

    case 'cname_at_host':
      return {
        headline: 'Something already lives at the challenge host',
        body: `It is a CNAME pointing at ${warning.target}. DNS does not allow other records alongside a CNAME, so a TXT added here would never resolve.`,
        fix: 'Remove that CNAME, or claim a different subdomain instead.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'domain_unregistered':
      return {
        headline: 'This name does not resolve at all',
        body: 'No nameservers answer for it, which usually means it is not registered or its delegation has not propagated. Once a record exists this is indistinguishable from a missing record, so it is worth saying now.',
        fix: 'Check the domain is registered and its nameservers are set.',
        waitingHelps: false,
        tone: 'problem',
      }

    case 'zone_failing':
      return {
        headline: 'The nameservers are failing to answer',
        body: 'Every resolver got an error rather than an answer when asking who runs this zone. Nothing can be published or read here until that clears — and it is upstream of us.',
        waitingHelps: null,
        tone: 'problem',
      }
  }
}

function quirkCopy(provider: Provider, cause: MismatchCause): Guidance {
  const base = { waitingHelps: false as const, tone: 'unknown' as const }
  switch (cause) {
    case 'quoted_value':
      return {
        ...base,
        headline: `${provider.name} adds the quotes for you`,
        body: `Paste the value into ${provider.valueLabel} without quotes of your own. ${provider.name} stores TXT data as a quoted string, so a value that arrives already quoted ends up quoted twice — and the record then reads as wrong.`,
      }
    case 'appended_apex':
      return {
        ...base,
        headline: `${provider.name} may append the domain to the value`,
        body: `Panels that treat a value as a hostname add the zone name to the end of it. If ${provider.valueLabel} shows your domain appended after the token, add a trailing dot or use the raw-value field.`,
      }
    case 'truncated':
      return {
        ...base,
        headline: `${provider.name} may cut a long value short`,
        body: 'Check that what the panel saved is the whole value, not just its beginning.',
      }
    case 'whitespace':
    case 'wrong_token':
    case 'wildcard_shadow':
    case 'unknown_value':
      return {
        ...base,
        headline: `A known quirk of ${provider.name}`,
        body: 'Copy the value with the button rather than by selecting it, and compare what the panel saved against what is shown here.',
      }
  }
}

export function humanTtl(seconds: number): string {
  if (seconds <= 0) return 'a moment'
  if (seconds < 90) return `${seconds} seconds`
  if (seconds < 5_400) return `${Math.round(seconds / 60)} minutes`
  return `${Math.round(seconds / 3_600)} hours`
}

export function humanUntil(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1_000))
  if (seconds < 45) return 'in a moment'
  if (seconds < 5_400) return `in ${Math.round(seconds / 60)} min`
  if (seconds < 129_600) return `in ${Math.round(seconds / 3_600)} h`
  return `in ${Math.round(seconds / 86_400)} d`
}

export function humanSince(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1_000))
  if (seconds < 45) return 'just now'
  if (seconds < 5_400) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 129_600) return `${Math.round(seconds / 3_600)} h ago`
  return `${Math.round(seconds / 86_400)} d ago`
}
