import { CHALLENGE_LABEL, type PreflightWarning, type Provider } from '@deed/core'
import { warningCopy } from '@/lib/copy'

/**
 * What the pre-flight found, as the four questions it actually asked.
 *
 * The dialog used to print the answers as loose lines and callouts, in whatever
 * order the warnings happened to be in, and said nothing at all about the
 * checks that passed — so a clean zone looked identical to one nobody had
 * looked at. These are the same three lookups either way (state-model §3); this
 * only decides how they read.
 *
 * Derivation, not rendering, so the cases can be asserted without a DOM.
 */
export type PreflightFindings = {
  readonly registered: boolean
  readonly zoneFailing: boolean
  readonly provider: Provider | null
  readonly wildcard: string | null
  readonly cnameAtHost: string | null
  readonly warnings: readonly PreflightWarning[]
}

export type PreflightStep = {
  readonly id: 'delegation' | 'provider' | 'host' | 'wildcard'
  readonly title: string
  /** Null only before there is an answer: a question with no answer yet. */
  readonly detail: string | null
  readonly state: 'todo' | 'done' | 'failed'
}

/** The questions, in the order the reader meets their consequences. */
const QUESTIONS = {
  delegation: 'The name is delegated',
  provider: 'The panel you will open',
  host: 'The host we will read',
  wildcard: 'Wildcards in this zone',
} as const

export function preflightSteps(name: string, found: PreflightFindings | null): PreflightStep[] {
  if (found === null) {
    return (['delegation', 'provider', 'host', 'wildcard'] as const).map((id) => ({
      id,
      title: QUESTIONS[id],
      detail: null,
      state: 'todo' as const,
    }))
  }

  const warning = (kind: PreflightWarning['kind']): PreflightWarning | undefined =>
    found.warnings.find((w) => w.kind === kind)

  // A failed check speaks in the words the diagnosis already has: writing a
  // second, shorter "this zone is failing" is how two sentences come to
  // disagree.
  const delegation = ((): PreflightStep => {
    const failing = warning('zone_failing')
    if (failing !== undefined) {
      const copy = warningCopy(failing)
      return { id: 'delegation', title: copy.headline, detail: copy.body, state: 'failed' }
    }
    const missing = warning('domain_unregistered')
    if (missing !== undefined) {
      const copy = warningCopy(missing)
      return { id: 'delegation', title: copy.headline, detail: copy.body, state: 'failed' }
    }
    return {
      id: 'delegation',
      title: QUESTIONS.delegation,
      detail: 'Its nameservers answered, so there is a zone to publish into.',
      state: 'done',
    }
  })()

  const provider = ((): PreflightStep => {
    const quirk = warning('provider_quirk')
    // The quirk's headline, not its body: the full explanation belongs beside
    // the field being pasted into, and the record card already carries it.
    if (quirk !== undefined) {
      return {
        id: 'provider',
        title: QUESTIONS.provider,
        detail: `${warningCopy(quirk).headline}. The instructions will use its field names.`,
        state: 'done',
      }
    }
    return {
      id: 'provider',
      title: QUESTIONS.provider,
      detail:
        found.provider === null
          ? 'Not a provider we recognise, so the instructions stay generic.'
          : `${found.provider.name}. The instructions will use its field names.`,
      state: 'done',
    }
  })()

  const host = ((): PreflightStep => {
    const blocked = warning('cname_at_host')
    if (blocked !== undefined) {
      const copy = warningCopy(blocked)
      return {
        id: 'host',
        title: copy.headline,
        detail: copy.fix === undefined ? copy.body : `${copy.body} ${copy.fix}`,
        state: 'failed',
      }
    }
    return {
      id: 'host',
      title: QUESTIONS.host,
      detail: `Nothing answers at ${CHALLENGE_LABEL}.${name} yet, which is where yours goes.`,
      state: 'done',
    }
  })()

  const wildcard = ((): PreflightStep => {
    const answering = warning('wildcard')
    // Not a failure. A wildcard answering for every name is legal and common;
    // it only means a missing record looks present, which is our problem to
    // handle rather than the user's to fix.
    if (answering !== undefined) {
      return {
        id: 'wildcard',
        title: warningCopy(answering).headline,
        detail: 'An explicit record still wins, and we check for yours specifically.',
        state: 'done',
      }
    }
    return {
      id: 'wildcard',
      title: QUESTIONS.wildcard,
      detail: 'A name that does not exist answers with nothing, so missing reads as missing.',
      state: 'done',
    }
  })()

  return [delegation, provider, host, wildcard]
}
