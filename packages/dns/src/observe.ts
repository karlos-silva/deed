import {
  type AuditActor,
  type Observation,
  type Timestamp,
  challengeHost,
} from '@deed/core'
import type { DnsPort } from './port'

/**
 * One completed check: the challenge host, plus a control probe at a random
 * unguessable *sibling* label under the claimed name.
 *
 * A sibling, not a child: DNS's closest-encloser rule means a wildcard one level
 * up may not even match the challenge host, so probing anywhere else would
 * answer a different question than the one being asked (state-model §3).
 */
export type ObserveOptions = {
  readonly now: Timestamp
  readonly actor: AuditActor
  /** The random label. Supplied by the caller, because the core has no randomness. */
  readonly probeLabel: string
  readonly timeoutMs?: number
}

export async function observe(
  port: DnsPort,
  name: string,
  options: ObserveOptions,
): Promise<Observation> {
  const context =
    options.timeoutMs === undefined
      ? { now: options.now }
      : { now: options.now, timeoutMs: options.timeoutMs }

  const [answers, probe] = await Promise.all([
    port.lookupTxt(challengeHost(name), context),
    port.lookupTxt(`${options.probeLabel}.${name}`, context),
  ])

  return { startedAt: options.now, actor: options.actor, answers, probe }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** 20 characters of unguessable label — a wildcard is the only thing that can answer it. */
export function randomProbeLabel(length = 20): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let label = ''
  for (const byte of bytes) label += ALPHABET.charAt(byte % ALPHABET.length)
  return label
}
